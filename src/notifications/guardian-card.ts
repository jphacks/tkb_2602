import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import {
  DEFAULT_GUARDIAN,
  GUARDIAN_KEYS,
  GUARDIANS,
  type GuardianKey,
  guardianImageKey,
  guardianStage,
  nextGuardianStage,
} from "../logic/guardian.js";

// 守り神の表示（4番の領域。1番が仮に作った）
// 守り神は本人にしか見せない。報告者の名前やIDは入れない

const GUARDIAN_COLOR = 0xbe9347; // 古金

export type GuardianMessage = {
  content: string;
  embeds: Array<{ title: string; description: string; color: number; image?: { url: string }; footer?: { text: string } }>;
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
        `守り神ポイント：**${points}**`,
        next ? `あと **${next.min - points}** ポイントで「${next.title}」に進化します` : "最後の姿まで進化しました",
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

export function guardianChoiceMessage(points: number): Omit<GuardianMessage, "embeds"> & { embeds: GuardianMessage["embeds"] } {
  return {
    content: [
      "## 🛡️ 守り神を選んでください",
      "片づけて観測を記録するたびに、守り神ポイントがたまり、守り神が育ちます。守り神は、あなたにだけ見えています。",
      "選べるのは1回だけです。選ぶまでは、白狐が見守っています。",
      points > 0 ? `\nいまの守り神ポイント：**${points}**` : "",
    ].join("\n"),
    embeds: GUARDIAN_KEYS.map((key) => ({
      title: GUARDIANS[key].name,
      description: GUARDIANS[key].description,
      color: GUARDIAN_COLOR,
    })),
    components: guardianChoiceRows(),
  };
}
