import {
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { getNow } from "../time.js";
import {
  deliverPendingNotifications,
  NotificationDeliveryInProgressError,
} from "../notifications/digest.js";
import type { Command } from "./types.js";

export const summary: Command = {
  data: new SlashCommandBuilder()
    .setName("summary")
    .setDescription("未報告の妖怪の変化を、全員に見えるメッセージでまとめて報告します")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply("このコマンドはサーバーの中で使ってください。");
      return;
    }

    // flagsを付けない通常応答なので、サーバー内の全員から見える。
    await interaction.deferReply();
    try {
      const count = await deliverPendingNotifications(
        guildId,
        await getNow(guildId),
        async (content) => interaction.editReply({ content }),
      );
      if (count === 0) {
        await interaction.editReply("未報告の妖怪の変化はありません。");
      }
    } catch (error) {
      if (error instanceof NotificationDeliveryInProgressError) {
        await interaction.editReply("現在、妖怪だよりを送信中です。少し待ってからもう一度お試しください。");
        return;
      }
      throw error;
    }
  },
};
