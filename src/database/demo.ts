import { supabase } from "./client.js";

// デモ用の操作（2番の領域。1番が /demo のために作った）
// 時間のずれは guild_settings.time_offset_seconds に保存する（sql/migrations/20261024_demo_time_offset.sql）

export async function getTimeOffsetSeconds(guildId: string): Promise<number> {
  const { data, error } = await supabase
    .from("guild_settings")
    .select("time_offset_seconds")
    .eq("guild_id", guildId)
    .maybeSingle<{ time_offset_seconds: number | string }>();
  if (error) throw new Error(`時間のずれの取得に失敗しました: ${error.message}`);
  return Number(data?.time_offset_seconds ?? 0);
}

export async function setTimeOffsetSeconds(guildId: string, seconds: number): Promise<void> {
  if (!Number.isInteger(seconds) || seconds < 0) throw new Error("時間のずれは0以上の整数にしてください");
  const { error } = await supabase
    .from("guild_settings")
    .update({ time_offset_seconds: seconds })
    .eq("guild_id", guildId);
  if (error) throw new Error(`時間のずれの保存に失敗しました: ${error.message}`);
}

export type ResetResult = {
  notificationJobs: number;
  reports: number;
  yokai: number;
  guardianPoints: number;
};

// 記録・妖怪・守り神ポイント・通知の予定を消し、時間のずれを0に戻す（設定と一覧は残る）
export async function resetDemoData(guildId: string): Promise<ResetResult> {
  const { data, error } = await supabase.rpc("reset_demo_data", { p_guild_id: guildId });
  if (error) throw new Error(`リセットに失敗しました: ${error.message}`);
  return data as ResetResult;
}
