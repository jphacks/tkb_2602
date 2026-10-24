import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { supabase } from "../database/client.js";
import { generateImage, generateText } from "./cloudflare.js";

// 管理者が追加した「やり残されていたこと」に、その研究室だけの妖怪を AI で作る（1番が作った）
//   1. 文章のAIに、妖怪の名前（日本語）と、見た目の説明（英語）を考えてもらう
//   2. 画像のAIで、指示書の画風に合わせた画像を作る
//   3. 成仏の姿（白黒にしてお札を貼る）を画像処理で作る
//   4. task_types に名前と画像のファイル名を保存する（すでに生まれている妖怪にも反映する）
//
// ★ AIに渡すのは、管理者が登録した項目の名前だけ。報告者の自由記述（ひとこと）は渡さない
//   （あだ名などから個人が特定される道を作らないため）

const ASSETS = fileURLToPath(new URL("../assets/", import.meta.url));

export type CustomYokai = {
  name: string;
  imageKey: string;
  birthPath: string;
  ascendPath: string;
};

export type Idea = { name: string; visual: string };

// 1. 名前と見た目の説明を考えてもらう。おかしな返事なら、決まった形に戻す
// テストから確かめられるように export している
export async function think(taskName: string): Promise<Idea> {
  const fallback: Idea = {
    name: `${taskName}の妖怪`,
    visual: "a small everyday shared-room object that keeps getting left in a bad state",
  };
  try {
    const raw = await generateText(
      [
        "You design cute, slightly cheeky Japanese 'everyday-object yokai' for a lab chore app.",
        "Given a neglected chore in Japanese, reply with ONLY one JSON object:",
        '{"name": "<Japanese yokai name, 3 to 10 characters, hiragana/katakana/kanji, playful, like あらいわすれ坊 or ゴミため坊>",',
        ' "visual": "<English, max 40 words: which everyday object the yokai is made of, and one small graphic clue of the neglected chore>"}',
        "Never include real people's names, body features, or anything insulting.",
      ].join("\n"),
      `Neglected chore: ${taskName}`,
    );
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Partial<Idea>;
    const name = typeof json.name === "string" ? json.name.trim() : "";
    const visual = typeof json.visual === "string" ? json.visual.trim() : "";
    return {
      name: /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー・]{2,12}$/u.test(name) ? name : fallback.name,
      visual: /^[\x20-\x7E]{10,300}$/.test(visual) ? visual : fallback.visual,
    };
  } catch (error) {
    console.error("[AI] 名前と見た目を考えられなかったので、決まった形にします:", error);
    return fallback;
  }
}

// 2. 画像の指示文（yokai_image_prompts の「妖怪用」の画風を短くしたもの）
export function imagePrompt(visual: string) {
  return [
    "Original everyday-object yokai character from a contemporary Japanese supernatural-fantasy television anime.",
    `The yokai is ${visual}.`,
    "Keep the object silhouette recognizable, with expressive anime eyes with visible irises and a small cheeky mouth integrated into the object body,",
    "slim clearly articulated arms and legs, a half-lidded shrewd but lovable expression, and a deliberate playful pose.",
    "Polished tapered deep-ink linework, solid non-pastel colors, decisive two-step indigo cel shading, upper-left key light, narrow teal edge light.",
    "Palette: indigo shadows, deep teal, cobalt, vermilion and antique-gold accents.",
    "One complete full-body character, centered, about 75 percent of a square frame.",
    "Single flat dark blue-gray background, no scenery, no floor, no text, no letters, no numbers, no logo, no watermark, no realistic dirt, no humans.",
  ].join(" ");
}

// 3. 成仏の姿のお札（文字は書かず、朱色の枠・丸い印・線だけ）
function talisman(size: number) {
  const w = Math.round(size * 0.15);
  const h = Math.round(size * 0.4);
  const line = Math.max(3, Math.round(w * 0.035));
  const cx = w / 2;
  const bar = (y: number, half: number) =>
    `<line x1="${cx - half}" y1="${y}" x2="${cx + half}" y2="${y}" stroke="#C94F40" stroke-width="${line * 1.6}" stroke-linecap="round"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w + 20}" height="${h + 20}">
  <rect x="14" y="14" width="${w}" height="${h}" rx="4" fill="#151C30" opacity="0.35"/>
  <rect x="6" y="6" width="${w}" height="${h}" rx="4" fill="#EFE3C2" stroke="#BE9347" stroke-width="${line}"/>
  <g transform="translate(6,6)">
    <circle cx="${cx}" cy="${h * 0.2}" r="${w * 0.22}" fill="none" stroke="#C94F40" stroke-width="${line * 1.8}"/>
    <circle cx="${cx}" cy="${h * 0.2}" r="${w * 0.08}" fill="#C94F40"/>
    ${bar(h * 0.4, w * 0.26)}
    <line x1="${cx}" y1="${h * 0.44}" x2="${cx}" y2="${h * 0.8}" stroke="#C94F40" stroke-width="${line * 2}" stroke-linecap="round"/>
    ${bar(h * 0.58, w * 0.2)}
    ${bar(h * 0.86, w * 0.16)}
  </g></svg>`);
}

async function ascendedImage(png: Buffer, size: number) {
  const gray = await sharp(png).grayscale().modulate({ brightness: 0.92 }).toColourspace("srgb").png().toBuffer();
  const tag = await sharp(talisman(size)).rotate(-12, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const meta = await sharp(tag).metadata();
  return sharp(gray)
    .composite([{ input: tag, left: Math.round(size / 2 - (meta.width ?? 0) / 2), top: Math.round(size / 2 - (meta.height ?? 0) / 2) }])
    .png()
    .toBuffer();
}

// 全部をまとめて行う。失敗したら例外を投げる（呼び出し側で、決まった妖怪のまま続ける）
export async function createCustomYokai(guildId: string, taskTypeId: string, taskName: string): Promise<CustomYokai> {
  const idea = await think(taskName);
  const jpeg = await generateImage(imagePrompt(idea.visual));

  const size = 1024;
  const png = await sharp(jpeg).resize(size, size, { fit: "cover" }).png().toBuffer();
  const imageKey = `custom_${taskTypeId}.png`;
  const birthPath = `${ASSETS}birth/${imageKey}`;
  const ascendPath = `${ASSETS}ascend/${imageKey}`;
  mkdirSync(`${ASSETS}birth`, { recursive: true });
  mkdirSync(`${ASSETS}ascend`, { recursive: true });
  writeFileSync(birthPath, png);
  writeFileSync(ascendPath, await ascendedImage(png, size));

  // 4. この項目の妖怪として保存する。すでに生まれている妖怪（決まった妖怪が付いていたもの）も差し替える
  const saved = await supabase
    .from("task_types")
    .update({ custom_yokai_name: idea.name, custom_image_key: imageKey })
    .eq("guild_id", guildId)
    .eq("id", taskTypeId);
  if (saved.error) throw new Error(`AIで作った妖怪の保存に失敗しました: ${saved.error.message}`);
  const born = await supabase
    .from("yokai_states")
    .update({ yokai_name: idea.name, image_key: imageKey })
    .eq("guild_id", guildId)
    .eq("task_type_id", taskTypeId)
    .in("stage", ["active", "ascended"]);
  if (born.error) throw new Error(`生まれている妖怪の更新に失敗しました: ${born.error.message}`);

  console.log(`[AI] 「${taskName}」の妖怪を作りました：${idea.name}（${imageKey}）`);
  return { name: idea.name, imageKey, birthPath, ascendPath };
}
