import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReportResult } from "../database/reports.js";
import type { YokaiIdentity } from "../database/yokai.js";

// /youkai の記録のあと、本人にだけ見せる返事（4番の領域）
// ※ 見た目（文章・画像・Embed）は4番が自由に作り直してください
//   報告者の名前やIDは、ここに絶対に入れない

export type ReplyContext = {
  locationName: string;
  taskTypeName: string;
};

// editReply にそのまま渡せる形
export type ReplyMessage = {
  content: string;
  embeds?: Array<{ title: string; description?: string; color?: number; image?: { url: string } }>;
  files?: Array<{ attachment: string; name: string }>;
};

const IMAGE_KEY_PATTERN = /^yokai_Y(?:0[1-9]|10)_lv(?:1|5|10|25)\.png$/;
const EVOLUTION_LEVELS = new Set([5, 10, 25]); // 画像が変わるレベル
const YOKAI_COLOR = 0x695099; // 青紫（妖怪の影の色）

// 出現・進化のときの画像（assets/birth/ にある）。なければ null
function yokaiImagePath(imageKey: string | null): string | null {
  if (!imageKey || !IMAGE_KEY_PATTERN.test(imageKey)) return null;
  const path = fileURLToPath(new URL(`../assets/birth/${imageKey}`, import.meta.url));
  return existsSync(path) ? path : null;
}

// 名前と画像のカード。画像がなければ文字だけにする
function yokaiCard(title: string, description: string, identity: YokaiIdentity): Omit<ReplyMessage, "content"> {
  const path = yokaiImagePath(identity.imageKey);
  if (!path || !identity.imageKey) return { embeds: [{ title, description, color: YOKAI_COLOR }] };
  return {
    embeds: [{ title, description, color: YOKAI_COLOR, image: { url: `attachment://${identity.imageKey}` } }],
    files: [{ attachment: path, name: identity.imageKey }],
  };
}

function nameOf(identity: YokaiIdentity) {
  return identity.yokaiName ?? "名もなき妖怪";
}

// 誕生の演出：この順番で、少しずつ返事を書き換える（最後のコマだけ名前と画像を出す）
export function birthFrames(result: ReportResult, context: ReplyContext, identity: YokaiIdentity): ReplyMessage[] {
  const where = `${context.locationName}の「${context.taskTypeName}」`;
  return [
    { content: `……${where}のあたりに、何かの気配がする。` },
    { content: "……影がこちらを見ている。" },
    {
      content: `観測を記録しました。\n${pointsLine(result)}`,
      ...yokaiCard(
        `${nameOf(identity)} が姿を現した！`,
        `${where}に住みついた妖怪です。（Lv.${result.yokaiLevel}）`,
        identity,
      ),
    },
  ];
}

// 画像が変わるレベル（5・10・25）に上がったときは、進化として画像つきで出す
export function isEvolution(result: ReportResult): boolean {
  return !result.duplicate && result.stage === "active" && EVOLUTION_LEVELS.has(result.yokaiLevel);
}

export function evolutionReply(result: ReportResult, context: ReplyContext, identity: YokaiIdentity): ReplyMessage {
  const where = `${context.locationName}の「${context.taskTypeName}」`;
  return {
    content: `観測を記録しました。\n${pointsLine(result)}`,
    ...yokaiCard(
      `${nameOf(identity)} が進化した！（Lv.${result.yokaiLevel}）`,
      `${where}のしわざが、まだ続いているようです。`,
      identity,
    ),
  };
}

// 誕生・進化以外の返事
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
  // stage が active で、誕生・進化ではない
  return `観測を記録しました。\n${where}の妖怪が力をつけた。（Lv.${result.yokaiLevel}）\n${pointsLine(result)}`;
}

function pointsLine(result: ReportResult) {
  return `守り神ポイント：${result.points}`;
}

// 誕生したときだけ演出を出すための判定（出現した直後はレベル1）
export function isBirth(result: ReportResult): boolean {
  return !result.duplicate && result.stage === "active" && result.yokaiLevel === 1;
}
