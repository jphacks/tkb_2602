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
  yokaiId?: string;
};

// まとめ通知で妖怪の名前を出すための情報（場所の名前と、妖怪の種類 Y01〜Y10）
export type YokaiSummary = {
  locationName: string;
  yokaiKey: string | null;
};

// 妖怪のIDから、場所の名前と妖怪の種類を引く（誕生・成仏を名前つきで出すため）
export async function getYokaiSummaries(
  guildId: string,
  yokaiIds: string[],
): Promise<Map<string, YokaiSummary>> {
  const result = new Map<string, YokaiSummary>();
  const ids = [...new Set(yokaiIds)];
  if (ids.length === 0) return result;

  const states = await supabase
    .from("yokai_states")
    .select("id, location_id, task_type_id")
    .eq("guild_id", guildId)
    .in("id", ids);
  if (states.error) throw new Error(`妖怪の情報の取得に失敗しました: ${states.error.message}`);

  const [locations, taskTypes] = await Promise.all([
    supabase.from("locations").select("id, name").eq("guild_id", guildId)
      .in("id", [...new Set(states.data.map((s) => s.location_id as string))]),
    supabase.from("task_types").select("id, yokai_key").eq("guild_id", guildId)
      .in("id", [...new Set(states.data.map((s) => s.task_type_id as string))]),
  ]);
  if (locations.error) throw new Error(`場所の取得に失敗しました: ${locations.error.message}`);
  if (taskTypes.error) throw new Error(`雑務の取得に失敗しました: ${taskTypes.error.message}`);

  const locationNames = new Map(locations.data.map((l) => [l.id as string, l.name as string]));
  const yokaiKeys = new Map(taskTypes.data.map((t) => [t.id as string, t.yokai_key as string | null]));
  for (const state of states.data) {
    result.set(state.id as string, {
      locationName: locationNames.get(state.location_id as string) ?? "どこか",
      yokaiKey: yokaiKeys.get(state.task_type_id as string) ?? null,
    });
  }
  return result;
}

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
  yokai_id?: string | null;
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
      .select("id, event_type, yokai_id")
      .eq("guild_id", guildId)
      .is("sent_at", null)
      .order("id")
      .range(from, to)
      .returns<JobRow[]>(),
    "未送信通知",
  );

  return rows.map((row) => ({ id: row.id, eventType: row.event_type, yokaiId: row.yokai_id ?? undefined }));
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
