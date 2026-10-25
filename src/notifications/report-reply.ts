import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReportResult } from "../database/reports.js";
import type { YokaiIdentity } from "../database/yokai.js";
import { guardianProgressBar } from "../logic/guardian.js";
import { yokaiIntroFromImageKey } from "./yokai-catalog.js";

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

// Y01〜Y10 の決まった妖怪と、AIで作った妖怪（custom_<項目のID>.png。どのレベルでも同じ画像）
const IMAGE_KEY_PATTERN = /^(?:yokai_Y(?:0[1-9]|10)_lv(?:1|5|10|25)|custom_[0-9a-f-]{36})\.png$/;
const EVOLUTION_LEVELS = new Set([5, 10, 25]); // 画像が変わるレベル

// カードの左の線の色（段階ごとに変える）
export const STAGE_COLORS = {
  presence: 0x8b8f98, // 気配：灰色
  shadow: 0x695099, // 影：青紫
  active: 0x2a9d8f, // 出現・進化・レベルアップ：青緑
} as const;

// 出現・進化のときの画像（assets/birth/ にある）。なければ null
function yokaiImagePath(imageKey: string | null): string | null {
  if (!imageKey || !IMAGE_KEY_PATTERN.test(imageKey)) return null;
  const path = fileURLToPath(new URL(`../assets/birth/${imageKey}`, import.meta.url));
  return existsSync(path) ? path : null;
}

// 名前と画像のカード。画像がなければ文字だけにする
function yokaiCard(title: string, description: string, identity: YokaiIdentity): Omit<ReplyMessage, "content"> {
  const color = STAGE_COLORS.active;
  const path = yokaiImagePath(identity.imageKey);
  if (!path || !identity.imageKey) return { embeds: [{ title, description, color }] };
  return {
    embeds: [{ title, description, color, image: { url: `attachment://${identity.imageKey}` } }],
    files: [{ attachment: path, name: identity.imageKey }],
  };
}

// 画像のない、文字だけのカード（気配・影・レベルアップ）
function textCard(content: string, title: string, description: string, color: number): ReplyMessage {
  return { content, embeds: [{ title, description, color }] };
}

function nameOf(identity: YokaiIdentity) {
  return identity.yokaiName ?? "名もなき妖怪";
}

// 誕生の演出：この順番で、少しずつ返事を書き換える（最後のコマだけ名前と画像を出す）
export function birthFrames(result: ReportResult, context: ReplyContext, identity: YokaiIdentity): ReplyMessage[] {
  const where = `${context.locationName}の「${context.taskTypeName}」`;
  const intro = yokaiIntroFromImageKey(identity.imageKey);
  return [
    textCard("", "気配", `……${where}のあたりに、何かの気配がする。`, STAGE_COLORS.presence),
    textCard("", "影", "……影がこちらを見ている。", STAGE_COLORS.shadow),
    {
      content: `観測を記録しました。\n${pointsLine(result)}`,
      ...yokaiCard(
        `${nameOf(identity)} が姿を現した！`,
        [`${where}に住みついた妖怪です。（Lv.${result.yokaiLevel}）`, ...(intro ? ["", intro] : [])].join("\n"),
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

// 誕生・進化以外の返事（段階ごとに色を変えたカードにする）
export function reportReply(result: ReportResult, context: ReplyContext): ReplyMessage {
  const where = `${context.locationName}の「${context.taskTypeName}」`;

  if (result.duplicate) {
    return { content: "この記録は、すでに受け付けています。" };
  }
  const content = `観測を記録しました。\n${pointsLine(result)}`;
  if (result.stage === "presence") {
    return textCard(content, "気配", `……${where}のあたりに、何かの気配がする。`, STAGE_COLORS.presence);
  }
  if (result.stage === "shadow") {
    return textCard(content, "影", `……${where}のあたりに、影がちらりと見えた。`, STAGE_COLORS.shadow);
  }
  // stage が active で、誕生・進化ではない
  return textCard(content, `レベルアップ（Lv.${result.yokaiLevel}）`, `${where}の妖怪が力をつけた。`, STAGE_COLORS.active);
}

function pointsLine(result: ReportResult) {
  const line = `守り神ポイント　${guardianProgressBar(result.points)}`;
  if (!result.duplicate && result.pointsAwarded === false) {
    return `${line}\n-# 同じ場所の同じことでは、ポイントは1時間に1回まで増えます`;
  }
  return line;
}

// 誕生したときだけ演出を出すための判定（出現した直後はレベル1）
export function isBirth(result: ReportResult): boolean {
  return !result.duplicate && result.stage === "active" && result.yokaiLevel === 1;
}
