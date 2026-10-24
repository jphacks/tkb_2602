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
