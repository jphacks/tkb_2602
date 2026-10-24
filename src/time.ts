import { getTimeOffsetSeconds } from "./database/demo.js";

// アプリの中の「今」。全員が必ずこれを使う（new Date() を直接使わない）
// 本当の今 ＋ デモ用の「時間のずれ」（guild_settings.time_offset_seconds）を返すので、/demo で時間を進められる

let warnedMissingOffset = false;

// 時間のずれ（ミリ秒）。読めなかったときは 0（本当の今）として動き続ける
export async function getTimeOffsetMs(guildId: string): Promise<number> {
  try {
    return (await getTimeOffsetSeconds(guildId)) * 1000;
  } catch (error) {
    // time_offset_seconds の列がまだデータベースにないときなど。ボットは止めない
    if (!warnedMissingOffset) {
      console.error("時間のずれを読めなかったので、本当の今で動きます:", error);
      warnedMissingOffset = true;
    }
    return 0;
  }
}

export async function getNow(guildId: string): Promise<Date> {
  return new Date(Date.now() + (await getTimeOffsetMs(guildId)));
}
