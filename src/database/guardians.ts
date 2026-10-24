import { type GuardianKey, isGuardianKey } from "../logic/guardian.js";
import { supabase } from "./client.js";

// 守り神（2番の領域。1番が /mamorigami のために作った）
// member_key は Discord ID を HMAC で変換した値（report-session.ts）。誰の守り神かはデータベースからはわからない
// guardian_key の列は sql/migrations/20261024_guardians.sql で足す

export type GuardianRecord = {
  guardianKey: GuardianKey | null; // まだ選んでいなければ null
  points: number;
};

export async function getGuardian(guildId: string, memberKey: string): Promise<GuardianRecord> {
  const { data, error } = await supabase
    .from("guardian_points")
    .select("guardian_key, points")
    .eq("guild_id", guildId)
    .eq("member_key", memberKey)
    .maybeSingle<{ guardian_key: string | null; points: number }>();
  if (error) throw new Error(`守り神の取得に失敗しました: ${error.message}`);
  return {
    guardianKey: isGuardianKey(data?.guardian_key) ? data.guardian_key : null,
    points: data?.points ?? 0,
  };
}

// 守り神を選ぶ。選べるのは最初の1回だけ（すでに選んでいたら、選んだ守り神のまま）
export async function chooseGuardian(guildId: string, memberKey: string, key: GuardianKey): Promise<GuardianRecord> {
  // まだ行がなければ、ポイント0で作る（すでにあれば何もしない）
  const inserted = await supabase
    .from("guardian_points")
    .upsert({ guild_id: guildId, member_key: memberKey, points: 0 }, {
      onConflict: "guild_id,member_key",
      ignoreDuplicates: true,
    });
  if (inserted.error) throw new Error(`守り神の保存に失敗しました: ${inserted.error.message}`);

  const updated = await supabase
    .from("guardian_points")
    .update({ guardian_key: key })
    .eq("guild_id", guildId)
    .eq("member_key", memberKey)
    .is("guardian_key", null);
  if (updated.error) throw new Error(`守り神の保存に失敗しました: ${updated.error.message}`);

  return getGuardian(guildId, memberKey);
}
