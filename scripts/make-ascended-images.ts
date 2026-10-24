// 成仏した妖怪の画像を作るスクリプト（npm run make-ascended-images）
// src/assets/yokai_Y01_lv1.png などの40枚を白黒にして、お札を貼った画像を
// src/assets/ascended/ に同じファイル名で書き出す。元の画像は変えない
//
// 使い方：
//   npm run make-ascended-images            … 40枚すべて
//   npm run make-ascended-images Y01_lv1    … 名前に Y01_lv1 を含むものだけ（試すとき）
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ASSETS = "src/assets";
const OUT = join(ASSETS, "ascended");
const filter = process.argv[2] ?? "";

// お札の絵（SVG）。文字は書かず、朱色の枠・丸い印・線だけで「封印のお札」に見せる
function talisman(size: number) {
  const w = Math.round(size * 0.15);
  const h = Math.round(size * 0.4);
  const pad = Math.round(w * 0.12);
  const line = Math.max(3, Math.round(w * 0.035));
  const cx = w / 2;
  const stroke = (y1: number, y2: number, x = cx) =>
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#C94F40" stroke-width="${line * 2}" stroke-linecap="round"/>`;
  const bar = (y: number, half: number) =>
    `<line x1="${cx - half}" y1="${y}" x2="${cx + half}" y2="${y}" stroke="#C94F40" stroke-width="${line * 1.6}" stroke-linecap="round"/>`;
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${w + 20}" height="${h + 20}">
  <rect x="14" y="14" width="${w}" height="${h}" rx="4" fill="#151C30" opacity="0.35"/>
  <rect x="6" y="6" width="${w}" height="${h}" rx="4" fill="#EFE3C2" stroke="#BE9347" stroke-width="${line}"/>
  <rect x="${6 + pad}" y="${6 + pad}" width="${w - pad * 2}" height="${h - pad * 2}" fill="none" stroke="#C94F40" stroke-width="${line}"/>
  <g transform="translate(6,6)">
    <circle cx="${cx}" cy="${h * 0.2}" r="${w * 0.22}" fill="none" stroke="#C94F40" stroke-width="${line * 1.8}"/>
    <circle cx="${cx}" cy="${h * 0.2}" r="${w * 0.08}" fill="#C94F40"/>
    ${bar(h * 0.38, w * 0.26)}
    ${stroke(h * 0.42, h * 0.78)}
    ${bar(h * 0.55, w * 0.2)}
    ${bar(h * 0.66, w * 0.24)}
    ${stroke(h * 0.6, h * 0.74, cx - w * 0.2)}
    ${stroke(h * 0.6, h * 0.74, cx + w * 0.2)}
    ${bar(h * 0.86, w * 0.16)}
  </g>
</svg>`);
}

async function makeAscended(file: string) {
  const input = join(ASSETS, file);
  const { width = 1024 } = await sharp(input).metadata();

  // 1. 白黒にする（透明な部分はそのまま）。少しだけ暗くして「抜け殻」らしくする
  const gray = await sharp(input).grayscale().modulate({ brightness: 0.92 }).toColourspace("srgb").png().toBuffer();

  // 2. お札を少し傾けて、体の中央より少し下に貼る
  const tag = await sharp(talisman(width)).rotate(-12, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const tagMeta = await sharp(tag).metadata();
  const left = Math.round(width * 0.5 - (tagMeta.width ?? 0) / 2);
  const top = Math.round(width * 0.5 - (tagMeta.height ?? 0) / 2);

  await sharp(gray)
    .composite([{ input: tag, left, top }])
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(join(OUT, file));
}

mkdirSync(OUT, { recursive: true });
const files = readdirSync(ASSETS).filter((f) => /^yokai_Y(0[1-9]|10)_lv(1|5|10|25)\.png$/.test(f) && f.includes(filter));
for (const file of files) {
  await makeAscended(file);
  console.log(`作成：${join(OUT, file)}`);
}
console.log(`${files.length}枚の成仏画像を作りました`);
