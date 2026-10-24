import type { ReportResult } from "../database/reports.js";

// /youkai の記録のあと、本人にだけ見せる返事（4番の領域）
// ※ 1番が仮に作った文章だけの版。見た目（画像・Embed）は4番が自由に作り直してください
//   報告者の名前やIDは、ここに絶対に入れない

export type ReplyContext = {
  locationName: string;
  taskTypeName: string;
};

// 誕生の演出：この順番で、少しずつ返事を書き換える
export function birthFrames(result: ReportResult, context: ReplyContext): string[] {
  const where = `${context.locationName}の「${context.taskTypeName}」`;
  return [
    `……${where}のあたりに、何かの気配がする。`,
    `……影がこちらを見ている。`,
    `**妖怪が姿を現した！**（Lv.${result.yokaiLevel}）\n（ここに妖怪の画像が入る予定）\n${pointsLine(result)}`,
  ];
}

// 誕生以外の返事
export function reportReply(result: ReportResult, context: ReplyContext): string {
  const where = `${context.locationName}の「${context.taskTypeName}」`;

  if (result.duplicate) {
    return "この記録は、すでに受け付けています。";
  }
  if (result.stage === "presence") {
    return `観測を記録しました。\n……${where}のあたりに、何かの気配がする。\n${pointsLine(result)}`;
  }
  if (result.stage === "shadow") {
    return `観測を記録しました。\n……${where}のあたりに、影がちらりと見えた。\n${pointsLine(result)}`;
  }
  // stage が active で、誕生ではない（2レベル目以降）
  return `観測を記録しました。\n${where}の妖怪が力をつけた。（Lv.${result.yokaiLevel}）\n${pointsLine(result)}`;
}

function pointsLine(result: ReportResult) {
  return `守り神ポイント：${result.points}`;
}

// 誕生したときだけ演出を出すための判定（出現した直後はレベル1）
export function isBirth(result: ReportResult): boolean {
  return !result.duplicate && result.stage === "active" && result.yokaiLevel === 1;
}
