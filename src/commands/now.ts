import {
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import {
  getCurrentActiveYokai,
  type CurrentActiveYokai,
} from "../database/current-yokai.js";
import { oharaiAdvice } from "../logic/oharai.js";
import type { Command } from "./types.js";

const MESSAGE_LIMIT = 1_900;

export function formatCurrentYokai(
  yokai: CurrentActiveYokai[],
): string[] {
  if (yokai.length === 0) return ["現在活動中の妖怪はいません。"];

  const sorted = [...yokai].sort((a, b) =>
    a.locationName.localeCompare(b.locationName, "ja")
    || a.yokaiName.localeCompare(b.yokaiName, "ja")
    || a.id.localeCompare(b.id)
  );
  const lines = ["## 👻 現在活動中の妖怪"];
  let currentLocation: string | null = null;
  for (const item of sorted) {
    if (item.locationName !== currentLocation) {
      lines.push("", `### ${item.locationName}`);
      currentLocation = item.locationName;
    }
    lines.push(`- **${item.yokaiName}**（${item.taskTypeName}）— レベル ${item.level}`);
    // どうすれば残らなくなるか（お祓いの作法）。誰かを責める言い方はしない
    lines.push(`  - お祓いの作法：${oharaiAdvice(item.taskTypeName)}`);
  }

  const messages: string[] = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > MESSAGE_LIMIT && current) {
      messages.push(current);
      current = `## 👻 現在活動中の妖怪（続き）\n${line}`;
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);
  return messages;
}

export const now: Command = {
  data: new SlashCommandBuilder()
    .setName("now")
    .setDescription("場所ごとに、現在活動中の妖怪とレベルを表示します")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply("このコマンドはサーバーの中で使ってください。");
      return;
    }

    // flagsを付けない通常応答なので、サーバー内の全員から見える。
    await interaction.deferReply();
    const messages = formatCurrentYokai(await getCurrentActiveYokai(guildId));
    await interaction.editReply(messages[0]);
    for (const content of messages.slice(1)) {
      await interaction.followUp({ content });
    }
  },
};
