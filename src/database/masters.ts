import type { MasterItem } from "../types.js";
import { supabase } from "./client.js";

// 場所と雑務の一覧を取る（2番）
// ※ 1番がとりあえず作った最小版。2番の設計に合わせて自由に直してください

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
    .order("name");
  if (error) throw error;
  return data;
}
