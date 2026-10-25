import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { chooseGuardian, getGuardian, getGuildPoints } from "../database/guardians.js";
import { myShareText } from "../logic/bias.js";
import { createReportSession } from "../database/report-session.js";
import { GUARDIANS, isGuardianKey } from "../logic/guardian.js";
import { guardianCard, guardianChoiceMessage } from "../notifications/guardian-card.js";
import type { Command } from "./types.js";

// /mamorigami：自分の守り神を見る・選ぶ（1番）。返事はすべて本人にだけ見える
// 守り神の記録は、Discord ID を HMAC で変換した値（memberKey）で読む。データベースには ID そのものは残らない

const NOT_READY = "守り神は準備中です（データベースの更新待ち）。少し待ってから、もう一度 /mamorigami を試してください。";

export const mamorigami: Command = {
  data: new SlashCommandBuilder()
    .setName("mamorigami")
    .setDescription("自分の守り神を見る（あなたにだけ見えます）")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { memberKey } = createReportSession(interaction.guildId!, interaction.user.id);
      const record = await getGuardian(interaction.guildId!, memberKey);
      // 自分が担った割合は、本人にだけ見せる（ほかの人の数は出さない）。読めなければ出さない
      const share = await getGuildPoints(interaction.guildId!)
        .then((points) => myShareText(record.points, points.reduce((sum, p) => sum + p, 0)))
        .catch(() => null);
      await interaction.editReply(
        record.guardianKey
          ? guardianCard(record.guardianKey, record.points, ["あなたの守り神です。", ...(share ? [`-# ${share}`] : [])].join("\n"))
          : guardianChoiceMessage(record.points),
      );
    } catch (error) {
      console.error("/mamorigami を開けませんでした:", error);
      await interaction.editReply(NOT_READY);
    }
  },

  // 守り神を選ぶボタン（/mamorigami と /youkai の返事のどちらからでも押せる）
  async handleComponent(interaction) {
    const [, action, key] = interaction.customId.split(":");
    if (action !== "choose" || !isGuardianKey(key)) return;
    await interaction.deferUpdate();
    try {
      const { memberKey } = createReportSession(interaction.guildId!, interaction.user.id);
      const record = await chooseGuardian(interaction.guildId!, memberKey, key);
      const headline =
        record.guardianKey === key
          ? `**${GUARDIANS[key].name}** を守り神に選びました。片づけるたびに、少しずつ育っていきます。`
          : `守り神はもう選んであります（${GUARDIANS[record.guardianKey ?? "A"].name}）。`;
      // 選ぶ画面の小さな画像5枚は消して（attachments: []）、選んだ守り神のカードにする
      await interaction.editReply({ ...guardianCard(record.guardianKey, record.points, headline), components: [], attachments: [] });
    } catch (error) {
      console.error("守り神を選べませんでした:", error);
      await interaction.followUp({ content: NOT_READY, flags: MessageFlags.Ephemeral });
    }
  },
};
