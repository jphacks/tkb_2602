import { supabase } from "./client.js";
import { getTaskThresholds } from "./masters.js";
import { displayYokaiName } from "../notifications/yokai-catalog.js";

export type CurrentActiveYokai = {
  id: string;
  locationId: string;
  locationName: string;
  taskTypeName: string;
  yokaiName: string;
  level: number;
};

type GuildSettingsRow = {
  birth_threshold: number;
};

type YokaiStateRow = {
  id: string;
  location_id: string;
  task_type_id: string;
  report_count: number;
  yokai_name: string | null;
  image_key: string | null;
  location: { name: string } | null;
  taskType: { name: string } | null;
};

// 誕生がまだ「妖怪だより」で知らされていない妖怪のID。
// こうした妖怪は、次の妖怪だよりまで /now や /zukan に出さない。
// すぐ出すと、見た人に「さっき誰かが観測した」と分かってしまうため。
export async function getUnannouncedBirthIds(guildId: string): Promise<Set<string>> {
  const pageSize = 500;
  const unannounced = new Set<string>();
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("notification_jobs")
      .select("id, yokai_id")
      .eq("guild_id", guildId)
      .eq("event_type", "birth")
      .is("sent_at", null)
      .order("id")
      .range(offset, offset + pageSize - 1)
      .returns<Array<{ id: string; yokai_id: string | null }>>();
    if (error) throw new Error(`未送信の誕生通知の取得に失敗しました: ${error.message}`);
    if (!data) throw new Error("未送信の誕生通知の取得結果がありません");
    if (data.length === 0) break;
    for (const job of data) if (job.yokai_id) unannounced.add(job.yokai_id);
  }
  return unannounced;
}

export async function getCurrentActiveYokai(
  guildId: string,
): Promise<CurrentActiveYokai[]> {
  if (typeof guildId !== "string" || !guildId.trim()) {
    throw new Error("サーバーIDを指定してください");
  }

  const { data: settings, error: settingsError } = await supabase
    .from("guild_settings")
    .select("birth_threshold")
    .eq("guild_id", guildId)
    .maybeSingle<GuildSettingsRow>();
  if (settingsError) {
    throw new Error(`サーバー設定の取得に失敗しました: ${settingsError.message}`);
  }
  if (!settings || !Number.isInteger(settings.birth_threshold)
    || settings.birth_threshold < 1) {
    throw new Error("妖怪の誕生に必要な報告回数の設定が不正です");
  }

  const rows: YokaiStateRow[] = [];
  const pageSize = 500;
  while (true) {
    const { data, error } = await supabase
      .from("yokai_states")
      .select(`
        id, location_id, task_type_id, report_count, yokai_name, image_key,
        location:locations(name),
        taskType:task_types(name)
      `)
      .eq("guild_id", guildId)
      .eq("stage", "active")
      .not("born_at", "is", null)
      .order("id")
      .range(rows.length, rows.length + pageSize - 1)
      .returns<YokaiStateRow[]>();
    if (error) throw new Error(`現在の妖怪の取得に失敗しました: ${error.message}`);
    if (!data) throw new Error("現在の妖怪の取得結果がありません");
    if (data.length === 0) break;
    rows.push(...data);
  }

  const unannounced = await getUnannouncedBirthIds(guildId);
  const taskThresholds = await getTaskThresholds(guildId);

  return rows.filter((row) => !unannounced.has(row.id)).map((row) => {
    if (!row.location || !row.taskType) {
      throw new Error("妖怪に対応する場所・やり残しの種類を取得できませんでした");
    }
    return {
      id: row.id,
      locationId: row.location_id,
      locationName: row.location.name,
      taskTypeName: row.taskType.name,
      yokaiName: displayYokaiName(row.yokai_name, row.image_key),
      // 雑務ごとの出現回数があれば、それでレベルを数える
      level: Math.max(1, row.report_count - (taskThresholds.get(row.task_type_id) ?? settings.birth_threshold) + 1),
    };
  });
}
