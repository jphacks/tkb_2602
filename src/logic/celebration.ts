// 健全な状態を、研究室全体で祝う（1番）
// 問題が起きなくなったことを、成仏の知らせと週に1回の知らせで伝え、良い状態を保つ励みにする。
// 誰が片づけたかは書かない。

export const QUIET_DAYS = 7; // この日数、新しい妖怪が生まれなければ「静かな1週間」として祝う
export const CELEBRATION_WEEKDAY = "Mon"; // 週に1回、この曜日の定時通知で祝う

// 成仏があって、研究室に妖怪がいなくなったとき（妖怪だよりの最後に添える）
export const ALL_CLEAR_LINES = [
  "",
  "### 🌸 いま、研究室に妖怪はいません",
  "みんなで、健全な状態を取り戻しました。",
];

// 新しい妖怪が生まれない1週間が続いたとき（週に1回の定時通知で送る）
export const QUIET_WEEK_MESSAGE = [
  "## 🌸 妖怪だより：静かな1週間",
  `この${QUIET_DAYS}日間、研究室に新しい妖怪は現れませんでした。`,
  "みんなで、健全な状態を保てています。",
].join("\n");

// 静かな1週間として祝うか。一度も妖怪が生まれていない研究室（まだ使い始めていない）では祝わない
export function isQuietWeek(health: { activeCount: number; lastBornAt: Date | null }, now: Date): boolean {
  if (health.activeCount > 0 || !health.lastBornAt) return false;
  return now.getTime() - health.lastBornAt.getTime() >= QUIET_DAYS * 24 * 60 * 60 * 1000;
}
