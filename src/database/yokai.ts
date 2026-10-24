import { supabase } from "./client.js";

// 妖怪1体の名前と、今の画像のファイル名（submit_report が yokai_states に保存したもの）
export type YokaiIdentity = {
  yokaiName: string | null;
  imageKey: string | null;
};

export async function getYokaiIdentity(guildId: string, yokaiId: string): Promise<YokaiIdentity> {
  const { data, error } = await supabase
    .from("yokai_states")
    .select("yokai_name, image_key")
    .eq("guild_id", guildId)
    .eq("id", yokaiId)
    .maybeSingle<{ yokai_name: string | null; image_key: string | null }>();
  if (error) throw new Error(`妖怪の名前と画像の取得に失敗しました: ${error.message}`);
  return { yokaiName: data?.yokai_name ?? null, imageKey: data?.image_key ?? null };
}
