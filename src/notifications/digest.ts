import type { Client } from "discord.js";
import {
  getNotificationSchedules,
  getPendingNotificationJobs,
  markNotificationJobsSent,
  type PendingNotificationJob,
} from "../database/notification-jobs.js";
import { getNow } from "../time.js";

const POLL_INTERVAL_MS = 30_000;
const handledSlots = new Map<string, string>();

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
    ...eventTypes.map((type) =>
      `- ${EVENT_LABELS[type] ?? type}：${counts.get(type)}件`),
  ].join("\n");
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

      const jobs = await getPendingNotificationJobs(schedule.guildId);
      if (jobs.length === 0) continue;

      const channel = await client.channels.fetch(schedule.channelId);
      if (!channel?.isSendable()) {
        throw new Error(`通知先チャンネル ${schedule.channelId} にメッセージを送信できません`);
      }
      await channel.send({ content: formatNotificationDigest(jobs) });
      await markNotificationJobsSent(jobs.map((job) => job.id), now);
      console.log(`[通知] Guild ${schedule.guildId}: ${jobs.length}件を送信しました`);
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
