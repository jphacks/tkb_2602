import { supabase } from "./client.js";

export type NotificationSchedule = {
  guildId: string;
  channelId: string;
  notificationTime: string;
  timezone: string;
};

export type PendingNotificationJob = {
  id: string;
  eventType: string;
};

export async function processYokaiAscensions(
  guildId: string,
  now: Date,
): Promise<number> {
  const { data, error } = await supabase.rpc("process_yokai_ascensions", {
    p_guild_id: guildId,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`成仏判定に失敗しました: ${error.message}`);
  if (typeof data !== "number") throw new Error("成仏判定の結果が不正です");
  return data;
}

type ScheduleRow = {
  guild_id: string;
  notification_channel_id: string | null;
  notification_time: string;
  timezone: string;
};

type JobRow = {
  id: string;
  event_type: string;
};

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

async function readAllPages<T>(
  readPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  while (true) {
    const { data, error } = await readPage(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(`${label}の取得に失敗しました: ${error.message}`);
    if (!data) throw new Error(`${label}の取得結果がありません`);
    if (data.length === 0) return rows;
    rows.push(...data);
  }
}

export async function getNotificationSchedules(): Promise<NotificationSchedule[]> {
  const rows = await readAllPages<ScheduleRow>(
    (from, to) => supabase
      .from("guild_settings")
      .select("guild_id, notification_channel_id, notification_time, timezone")
      .not("notification_channel_id", "is", null)
      .order("guild_id")
      .range(from, to)
      .returns<ScheduleRow[]>(),
    "通知設定",
  );

  return rows.flatMap((row) => row.notification_channel_id ? [{
    guildId: row.guild_id,
    channelId: row.notification_channel_id,
    notificationTime: row.notification_time,
    timezone: row.timezone,
  }] : []);
}

export async function getPendingNotificationJobs(
  guildId: string,
): Promise<PendingNotificationJob[]> {
  const rows = await readAllPages<JobRow>(
    (from, to) => supabase
      .from("notification_jobs")
      .select("id, event_type")
      .eq("guild_id", guildId)
      .is("sent_at", null)
      .order("id")
      .range(from, to)
      .returns<JobRow[]>(),
    "未送信通知",
  );

  return rows.map((row) => ({ id: row.id, eventType: row.event_type }));
}

export async function markNotificationJobsSent(
  jobIds: string[],
  sentAt: Date,
): Promise<void> {
  for (let from = 0; from < jobIds.length; from += 500) {
    const { error } = await supabase
      .from("notification_jobs")
      .update({ sent_at: sentAt.toISOString() })
      .in("id", jobIds.slice(from, from + 500))
      .is("sent_at", null);
    if (error) throw new Error(`通知済み状態の保存に失敗しました: ${error.message}`);
  }
}
