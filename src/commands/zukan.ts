import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { getZukanEntries, type ZukanEntry } from "../database/zukan.js";
import { oharaiAdvice } from "../logic/oharai.js";
import type { Command } from "./types.js";

// /zukan：妖怪図鑑（1番）。これまでに出会った妖怪と、それぞれのお祓いの作法を見る（本人にだけ見える）
// 成仏した妖怪の作法は「この研究室で効いたこと」として、次に同じ問題が起きたときの手がかりにする

const MESSAGE_LIMIT = 1_900;

function entryLines(entry: ZukanEntry) {
  return [
    `- **${entry.yokaiName}**（${entry.locationName}の「${entry.taskTypeName}」）`,
    `  - お祓いの作法：${oharaiAdvice(entry.taskTypeName)}`,
  ];
}

export function formatZukan(entries: ZukanEntry[]): string[] {
  if (entries.length === 0) {
    return ["まだ妖怪に出会っていません。妖怪だよりで知らされた妖怪が、ここに記録されます。"];
  }
  const byName = (a: ZukanEntry, b: ZukanEntry) =>
    a.yokaiName.localeCompare(b.yokaiName, "ja") || a.locationName.localeCompare(b.locationName, "ja") || a.id.localeCompare(b.id);
  const active = entries.filter((e) => !e.ascended).sort(byName);
  const ascended = entries.filter((e) => e.ascended).sort(byName);

  const lines = [
    "## 📖 妖怪図鑑",
    `この研究室で出会った妖怪：**${entries.length}体**（いまいる ${active.length}体・成仏 ${ascended.length}体）`,
    ...(active.length > 0 ? ["", "### 👻 いまいる妖怪", ...active.flatMap(entryLines)] : []),
    ...(ascended.length > 0
      ? [
        "",
        "### 🪷 成仏した妖怪",
        "-# この研究室で、同じことが起きなくなった妖怪です。効いた工夫は #毎日報告 の成仏の知らせへの返信にも残っています",
        ...ascended.flatMap(entryLines),
      ]
      : []),
  ];

  // Discord の1通の長さを超えないように分ける
  const messages: string[] = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > MESSAGE_LIMIT && current) {
      messages.push(current);
      current = `## 📖 妖怪図鑑（続き）\n${line}`;
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);
  return messages;
}

export const zukan: Command = {
  data: new SlashCommandBuilder()
    .setName("zukan")
    .setDescription("妖怪図鑑：これまでに出会った妖怪と、お祓いの作法を見る（あなたにだけ見えます）")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: "このコマンドはサーバーの中で使ってください。", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const messages = formatZukan(await getZukanEntries(guildId));
      await interaction.editReply(messages[0]);
      for (const content of messages.slice(1)) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      console.error("/zukan を開けませんでした:", error);
      await interaction.editReply("妖怪図鑑を開けませんでした。少し待ってから、もう一度試してください。");
    }
  },
};
