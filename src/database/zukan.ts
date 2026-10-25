import { supabase } from "./client.js";
import { getUnannouncedBirthIds } from "./current-yokai.js";
import { displayYokaiName } from "../notifications/yokai-catalog.js";

// 妖怪図鑑（1番）：このサーバーで、これまでに出会った妖怪（今いる妖怪と、成仏した妖怪）
// 誕生がまだ妖怪だよりで知らされていない妖怪は、/now と同じく出さない

export type ZukanEntry = {
  id: string;
  yokaiName: string;
  locationName: string;
  taskTypeName: string;
  ascended: boolean;
};

type Row = {
  id: string;
  stage: string;
  yokai_name: string | null;
  image_key: string | null;
  location: { name: string } | null;
  taskType: { name: string } | null;
};

export async function getZukanEntries(guildId: string): Promise<ZukanEntry[]> {
  const rows: Row[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("yokai_states")
      .select("id, stage, yokai_name, image_key, location:locations(name), taskType:task_types(name)")
      .eq("guild_id", guildId)
      .in("stage", ["active", "ascended"])
      .not("born_at", "is", null)
      .order("id")
      .range(offset, offset + pageSize - 1)
      .returns<Row[]>();
    if (error) throw new Error(`妖怪図鑑の取得に失敗しました: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
  }

  const unannounced = await getUnannouncedBirthIds(guildId);
  return rows
    .filter((row) => !unannounced.has(row.id) && row.location && row.taskType)
    .map((row) => ({
      id: row.id,
      yokaiName: displayYokaiName(row.yokai_name, row.image_key),
      locationName: row.location!.name,
      taskTypeName: row.taskType!.name,
      ascended: row.stage === "ascended",
    }));
}
