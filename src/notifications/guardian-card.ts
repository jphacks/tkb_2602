import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import {
  DEFAULT_GUARDIAN,
  GUARDIAN_KEYS,
  GUARDIANS,
  type GuardianKey,
  guardianImageKey,
  guardianProgressBar,
  guardianStage,
  nextGuardianStage,
} from "../logic/guardian.js";

// 守り神の表示（4番の領域。1番が仮に作った）
// 守り神は本人にしか見せない。報告者の名前やIDは入れない

const GUARDIAN_COLOR = 0xbe9347; // 古金

export type GuardianMessage = {
  content: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    image?: { url: string };
    thumbnail?: { url: string };
    footer?: { text: string };
  }>;
  files?: Array<{ attachment: string; name: string }>;
  components?: ActionRowBuilder<ButtonBuilder>[];
};

function guardianImagePath(imageKey: string): string | null {
  const path = fileURLToPath(new URL(`../assets/birth/${imageKey}`, import.meta.url));
  return existsSync(path) ? path : null;
}

// 守り神のカード（画像・名前・段階・ポイント・次の進化まで）
export function guardianCard(key: GuardianKey | null, points: number, headline: string): GuardianMessage {
  const guardianKey = key ?? DEFAULT_GUARDIAN;
  const guardian = GUARDIANS[guardianKey];
  const stage = guardianStage(points);
  const next = nextGuardianStage(points);
  const imageKey = guardianImageKey(guardianKey, points);
  const path = guardianImagePath(imageKey);
  return {
    content: headline,
    embeds: [{
      title: `${guardian.name}（${stage.title}）`,
      description: [
        guardian.description,
        "",
        `守り神ポイント　${guardianProgressBar(points)}`,
        next ? `「${next.title}」に進化するまで、あと **${next.min - points}** ポイント` : "最後の姿まで進化しました",
      ].join("\n"),
      color: GUARDIAN_COLOR,
      ...(path ? { image: { url: `attachment://${imageKey}` } } : {}),
      footer: { text: "守り神は、あなたにだけ見えています" },
    }],
    ...(path ? { files: [{ attachment: path, name: imageKey }] } : {}),
  };
}

// 守り神を選ぶボタン（customId は mamorigami:choose:A など。/mamorigami が受け取る）
export function guardianChoiceRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      GUARDIAN_KEYS.map((key) =>
        new ButtonBuilder().setCustomId(`mamorigami:choose:${key}`).setLabel(GUARDIANS[key].name).setStyle(ButtonStyle.Primary),
      ),
    ),
  ];
}

// 選ぶ画面の小さな画像（assets/thumb/kami_A_lv1.png など。256×256 で軽くしてある）
function guardianThumbPath(key: GuardianKey): string | null {
  const path = fileURLToPath(new URL(`../assets/thumb/kami_${key}_lv1.png`, import.meta.url));
  return existsSync(path) ? path : null;
}

export function guardianChoiceMessage(points: number): GuardianMessage {
  const thumbs = GUARDIAN_KEYS.map((key) => ({ key, path: guardianThumbPath(key) }));
  return {
    content: [
      "## 🛡️ 守り神を選んでください",
      "片づけて観測を記録するたびに、守り神ポイントがたまり、守り神が育ちます。守り神は、あなたにだけ見えています。",
      "選べるのは1回だけです。選ぶまでは、白狐が見守っています。",
      points > 0 ? `\nいまの守り神ポイント：**${points}**` : "",
    ].join("\n"),
    // 5体それぞれのカードの右に、こまもり（Lv1）の姿を小さく出す
    embeds: thumbs.map(({ key, path }) => ({
      title: GUARDIANS[key].name,
      description: GUARDIANS[key].description,
      color: GUARDIAN_COLOR,
      ...(path ? { thumbnail: { url: `attachment://choice_kami_${key}.png` } } : {}),
    })),
    files: thumbs.flatMap(({ key, path }) => (path ? [{ attachment: path, name: `choice_kami_${key}.png` }] : [])),
    components: guardianChoiceRows(),
  };
}
