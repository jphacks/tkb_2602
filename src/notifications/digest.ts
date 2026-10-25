import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "discord.js";
import {
  getNotificationSchedules,
  getPendingNotificationJobs,
  markNotificationJobsSent,
  processYokaiAscensions,
  type PendingNotificationJob,
} from "../database/notification-jobs.js";
import { getNow } from "../time.js";
import { ASCEND_HINT, oharaiAdvice } from "../logic/oharai.js";
import { displayYokaiName } from "./yokai-catalog.js";

const POLL_INTERVAL_MS = 60_000;
const handledSlots = new Map<string, string>();
const deliveringGuilds = new Set<string>();

const EVENT_LABELS: Record<string, string> = {
  presence: "気配",
  shadow: "影",
  birth: "妖怪誕生",
  level_up: "レベルアップ",
  weaken: "弱体化",
  ascend: "成仏",
};

export type NotificationMessage = {
  content: string;
  embeds?: Array<{ title: string; description?: string; image?: { url: string } }>;
  files?: Array<{ attachment: string; name: string }>;
};

// Y01〜Y10 の決まった妖怪と、AIで作った妖怪（custom_<項目のID>.png。どのレベルでも同じ画像）
const IMAGE_KEY_PATTERN = /^(?:yokai_Y(?:0[1-9]|10)_lv(?:1|5|10|25)|custom_[0-9a-f-]{36})\.png$/;

function imagePath(imageKey: string | null, eventType: string): string | null {
  if (!imageKey || !IMAGE_KEY_PATTERN.test(imageKey)) return null;
  const directory = eventType === "birth"
    ? "birth"
    : eventType === "ascend"
      ? "ascend"
      : null;
  if (!directory) return null;
  const path = fileURLToPath(
    new URL(`../assets/${directory}/${imageKey}`, import.meta.url),
  );
  return existsSync(path) ? path : null;
}

function localDateAndTime(now: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  if (!year || !month || !day || !hour || !minute) {
    throw new Error(`タイムゾーン ${timezone} の日時を計算できません`);
  }
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

function normalizeNotificationTime(value: string): string {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`通知時刻が不正です: ${value}`);
  }
  return `${match[1]}:${match[2]}`;
}

export function formatNotificationDigest(jobs: PendingNotificationJob[]): string {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    counts.set(job.eventType, (counts.get(job.eventType) ?? 0) + 1);
  }
  const knownOrder = ["presence", "shadow", "birth", "level_up", "weaken", "ascend"];
  const eventTypes = [
    ...knownOrder.filter((type) => counts.has(type)),
    ...[...counts.keys()].filter((type) => !knownOrder.includes(type)).sort(),
  ];
  return [
    "## 👻 妖怪だより",
    `未報告だった変化は **${jobs.length}件** です。`,
    ...eventTypes.flatMap((type) => [
      `- ${EVENT_LABELS[type] ?? type}：${counts.get(type)}件`,
      ...jobs
        .filter((job) =>
          job.eventType === type &&
          (type === "birth" || type === "ascend") &&
          job.yokaiId
        )
        .flatMap((job) => [
          `  - **${displayYokaiName(job.yokaiName, job.imageKey)}**`,
          // 生まれた妖怪には、どうすれば残らなくなるか（お祓いの作法）を添える
          ...(type === "birth" ? [`    - お祓いの作法：${oharaiAdvice(job.taskName)}`] : []),
        ]),
    ]),
  ].join("\n");
}

export function buildNotificationDigestMessages(
  jobs: PendingNotificationJob[],
): NotificationMessage[] {
  const featured = jobs.filter((job) =>
    (job.eventType === "birth" || job.eventType === "ascend") && job.yokaiId
  );
  if (featured.length === 0) return [{ content: formatNotificationDigest(jobs) }];

  const messages: NotificationMessage[] = [];
  for (let from = 0; from < featured.length; from += 10) {
    const chunk = featured.slice(from, from + 10);
    const files: NonNullable<NotificationMessage["files"]> = [];
    const embeds = chunk.map((job) => {
      const name = displayYokaiName(job.yokaiName, job.imageKey);
      const title = `${EVENT_LABELS[job.eventType] ?? job.eventType}：${name}`;
      const path = imagePath(job.imageKey, job.eventType);
      const description = job.eventType === "birth"
        ? `お祓いの作法：${oharaiAdvice(job.taskName)}\n-# ${ASCEND_HINT}`
        : undefined;
      if (!path || !job.imageKey) return { title, ...(description ? { description } : {}) };

      const attachmentName = `${job.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${job.imageKey}`;
      files.push({ attachment: path, name: attachmentName });
      return { title, ...(description ? { description } : {}), image: { url: `attachment://${attachmentName}` } };
    });
    messages.push({
      content: from === 0
        ? formatNotificationDigest(jobs)
        : `## 👻 妖怪だより（画像 ${Math.floor(from / 10) + 1}）`,
      embeds,
      ...(files.length > 0 ? { files } : {}),
    });
  }
  return messages;
}

export class NotificationDeliveryInProgressError extends Error {
  constructor() {
    super("このサーバーの通知は別の処理で送信中です");
    this.name = "NotificationDeliveryInProgressError";
  }
}

// 定時通知と /summary が同じ処理を使うことで、集計内容と送信済み判定を揃える。
// Discordへの送信に成功するまでは sent_at を更新しない。
export async function deliverPendingNotifications(
  guildId: string,
  sentAt: Date,
  send: (messages: NotificationMessage[]) => Promise<unknown>,
): Promise<number> {
  if (deliveringGuilds.has(guildId)) {
    throw new NotificationDeliveryInProgressError();
  }

  deliveringGuilds.add(guildId);
  try {
    // 通知を読む直前に成仏を確定し、その通知ジョブも今回のまとめへ含める。
    await processYokaiAscensions(guildId, sentAt);
    const jobs = await getPendingNotificationJobs(guildId);
    if (jobs.length === 0) return 0;

    await send(buildNotificationDigestMessages(jobs));
    await markNotificationJobsSent(jobs.map((job) => job.id), sentAt);
    return jobs.length;
  } finally {
    deliveringGuilds.delete(guildId);
  }
}

export async function runScheduledNotifications(
  client: Client,
  nowForGuild: (guildId: string) => Promise<Date> = getNow,
): Promise<void> {
  const schedules = await getNotificationSchedules();
  for (const schedule of schedules) {
    try {
      const now = await nowForGuild(schedule.guildId);
      const local = localDateAndTime(now, schedule.timezone);
      if (local.time !== normalizeNotificationTime(schedule.notificationTime)) continue;

      const slot = `${local.date}T${local.time}`;
      if (handledSlots.get(schedule.guildId) === slot) continue;
      handledSlots.set(schedule.guildId, slot);

      const count = await deliverPendingNotifications(
        schedule.guildId,
        now,
        async (messages) => {
          const channel = await client.channels.fetch(schedule.channelId);
          if (!channel?.isSendable()) {
            throw new Error(`通知先チャンネル ${schedule.channelId} にメッセージを送信できません`);
          }
          for (const message of messages) await channel.send(message);
        },
      );
      if (count > 0) {
        console.log(`[通知] Guild ${schedule.guildId}: ${count}件を送信しました`);
      }
    } catch (error) {
      handledSlots.delete(schedule.guildId);
      console.error(`[通知] Guild ${schedule.guildId} の送信に失敗しました`, error);
    }
  }
}

export function startNotificationScheduler(client: Client): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledNotifications(client);
    } catch (error) {
      console.error("通知スケジューラーの実行に失敗しました", error);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
