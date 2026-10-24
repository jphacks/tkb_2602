import type { Client } from "discord.js";
import {
  getNotificationSchedules,
  getPendingNotificationJobs,
  getYokaiSummaries,
  markNotificationJobsSent,
  processYokaiAscensions,
  type PendingNotificationJob,
  type YokaiSummary,
} from "../database/notification-jobs.js";
import { getNow } from "../time.js";
import { yokaiName } from "./yokai-catalog.js";

// 誕生と成仏は、どの妖怪かを名前で出す（ほかの出来事は件数だけ）
const NAMED_EVENT_TYPES = new Set(["birth", "ascend"]);

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

export function formatNotificationDigest(
  jobs: PendingNotificationJob[],
  yokai: Map<string, YokaiSummary> = new Map(),
): string {
  // 誕生・成仏した妖怪を「場所の 名前」で並べる（情報が取れなかったものは件数だけになる）
  const namedLines = (type: string) =>
    jobs
      .filter((job) => job.eventType === type && job.yokaiId && yokai.has(job.yokaiId))
      .map((job) => {
        const summary = yokai.get(job.yokaiId!)!;
        return `  - ${summary.locationName}の **${yokaiName(summary.yokaiKey)}**`;
      });
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
      ...(NAMED_EVENT_TYPES.has(type) ? namedLines(type) : []),
    ]),
  ].join("\n");
}

// 誕生・成仏した妖怪の名前を引く。失敗しても、まとめ通知は件数だけで送れるようにする
async function getNamedYokai(guildId: string, jobs: PendingNotificationJob[]) {
  const ids = jobs.filter((job) => NAMED_EVENT_TYPES.has(job.eventType) && job.yokaiId).map((job) => job.yokaiId!);
  if (ids.length === 0) return new Map<string, YokaiSummary>();
  try {
    return await getYokaiSummaries(guildId, ids);
  } catch (error) {
    console.error("[通知] 妖怪の名前を取得できなかったので、件数だけで送ります", error);
    return new Map<string, YokaiSummary>();
  }
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
  send: (content: string) => Promise<unknown>,
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

    await send(formatNotificationDigest(jobs, await getNamedYokai(guildId, jobs)));
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
        async (content) => {
          const channel = await client.channels.fetch(schedule.channelId);
          if (!channel?.isSendable()) {
            throw new Error(`通知先チャンネル ${schedule.channelId} にメッセージを送信できません`);
          }
          await channel.send({ content });
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
