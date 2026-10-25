import type { MasterItem } from "../types.js";
import { supabase } from "./client.js";

// 現在使う場所と雑務だけを、報告画面・設定画面に表示する。

export async function getLocations(guildId: string): Promise<MasterItem[]> {
  const { data, error } = await supabase
    .from("locations")
    .select("id, name")
    .eq("guild_id", guildId)
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data;
}

export async function getTaskTypes(guildId: string): Promise<MasterItem[]> {
  const { data, error } = await supabase
    .from("task_types")
    .select("id, name")
    .eq("guild_id", guildId)
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data;
}

// 雑務ごとの出現回数（task_types.birth_threshold。sql/migrations/20261025_task_birth_threshold.sql）。
// 雑務のID → 回数。決めていない雑務は入らない。
// 列がまだないデータベースでも止まらないように、読めなければ空にする（全体の値だけで動く）。
export async function getTaskThresholds(guildId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("task_types")
    .select("id, birth_threshold")
    .eq("guild_id", guildId)
    .eq("is_active", true)
    .not("birth_threshold", "is", null);
  if (error) {
    console.error("雑務ごとの出現回数を読めませんでした（全体の値で動きます）:", error.message);
    return new Map();
  }
  return new Map((data ?? []).map((row: { id: string; birth_threshold: number }) => [row.id, row.birth_threshold]));
}

// 雑務ごとの出現回数を保存する（名前 → 回数。null なら全体の値に戻す）
export async function saveTaskThresholds(guildId: string, thresholds: Map<string, number | null>): Promise<void> {
  for (const [name, threshold] of thresholds) {
    const { error } = await supabase
      .from("task_types")
      .update({ birth_threshold: threshold })
      .eq("guild_id", guildId)
      .eq("name", name)
      .eq("is_active", true);
    if (error) throw new Error(`雑務ごとの出現回数の保存に失敗しました: ${error.message}`);
  }
}
