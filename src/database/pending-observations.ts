import { supabase } from "./client.js";

// 「一覧にない」で記録された観測（2番の領域。1番が作った）
// 管理者が選択肢に追加するまで置いておき、追加したときに「1回目」として数える
// ひとことの文章と、報告者の Discord ID は保存しない（member_key は HMAC で変換した値）

export type PendingObservation = {
  id: string;
  guildId: string;
  locationId: string | null; // null なら場所も「一覧にない」
  taskTypeId: string | null; // null ならやり残されていたことも「一覧にない」
  memberKey: string;
  resolved: boolean;
};

type Row = {
  id: string;
  guild_id: string;
  location_id: string | null;
  task_type_id: string | null;
  member_key: string;
  resolved_at: string | null;
};

export async function createPendingObservation(
  input: Omit<PendingObservation, "id" | "resolved">,
): Promise<string> {
  const { data, error } = await supabase
    .from("pending_observations")
    .insert({
      guild_id: input.guildId,
      location_id: input.locationId,
      task_type_id: input.taskTypeId,
      member_key: input.memberKey,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`追加待ちの観測の保存に失敗しました: ${error.message}`);
  return data.id;
}

export async function getPendingObservation(guildId: string, id: string): Promise<PendingObservation | null> {
  const { data, error } = await supabase
    .from("pending_observations")
    .select("id, guild_id, location_id, task_type_id, member_key, resolved_at")
    .eq("guild_id", guildId)
    .eq("id", id)
    .maybeSingle<Row>();
  if (error) throw new Error(`追加待ちの観測の取得に失敗しました: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    guildId: data.guild_id,
    locationId: data.location_id,
    taskTypeId: data.task_type_id,
    memberKey: data.member_key,
    resolved: data.resolved_at !== null,
  };
}

export async function resolvePendingObservation(guildId: string, id: string, resolvedAt: Date): Promise<void> {
  const { error } = await supabase
    .from("pending_observations")
    .update({ resolved_at: resolvedAt.toISOString() })
    .eq("guild_id", guildId)
    .eq("id", id);
  if (error) throw new Error(`追加待ちの観測の更新に失敗しました: ${error.message}`);
}
