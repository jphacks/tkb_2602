// アプリの中の「今」。全員が必ずこれを使う（new Date() を直接使わない）
// 本当の今 ＋ デモ用の「時間のずれ」を返すので、/demo で時間を進められる
//
// TODO（2番）：「時間のずれ」を guild_settings に保存し、ここで読み込む
export async function getNow(_guildId: string): Promise<Date> {
  const offsetMs = 0; // いまは「ずれ」なし
  return new Date(Date.now() + offsetMs);
}
