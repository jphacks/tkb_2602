import { supabase } from "./client.js";

// サーバーごとの設定（2番）
// ※ 1番が /youkai-settei のために作った仮版。読む部分は既存の guild_settings から読み、
//   保存する部分（save〜）はまだ中身がない。2番の設計に合わせて自由に直してください

export type GuildSettings = {
  notificationChannelId: string | null; // まとめ通知を送るチャンネル（#妖怪だより）
  adminChannelId: string | null; // 管理者に「ひとこと」を届けるチャンネル
  digestHour: number; // まとめ通知を送る時刻（0〜23時）
  birthThreshold: number; // 妖怪が出現する回数
};

const DEFAULT_DIGEST_HOUR = 18;

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const { data, error } = await supabase
    .from("guild_settings")
    .select("notification_channel_id, admin_channel_id, birth_threshold")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (error) throw error;

  return {
    notificationChannelId: data?.notification_channel_id ?? null,
    adminChannelId: data?.admin_channel_id ?? null,
    // TODO（2番）：guild_settings に「まとめ通知の時刻」の列（例：digest_hour）を足して、ここで読む
    digestHour: DEFAULT_DIGEST_HOUR,
    birthThreshold: data?.birth_threshold ?? 3,
  };
}

// TODO（2番）：設定を guild_settings に保存する（なければ行を作る）
export async function saveGuildSettings(guildId: string, settings: GuildSettings): Promise<void> {
  console.log(`[未保存] 設定 ${guildId}`, settings);
}

// TODO（2番）：場所の一覧を、渡された名前のとおりにそろえる
//   ・一覧にない名前は追加する
//   ・一覧から消えた名前は削除せず is_active = false にする（妖怪や記録とのつながりを残すため）
//   ・使わない状態の名前がまた入ってきたら is_active = true に戻す
export async function saveLocationNames(guildId: string, names: string[]): Promise<void> {
  console.log(`[未保存] 場所の一覧 ${guildId}`, names);
}

// TODO（2番）：やり残されていたことの一覧を、渡された名前のとおりにそろえる（場所と同じ考え方）
//   新しく追加したものには、まだ使っていない妖怪（Y01〜Y10）を割り当てる
export async function saveTaskTypeNames(guildId: string, names: string[]): Promise<void> {
  console.log(`[未保存] やり残されていたことの一覧 ${guildId}`, names);
}
