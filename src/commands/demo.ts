import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  InteractionContextType,
  type MessageComponentInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { getTimeOffsetSeconds, resetDemoData, setTimeOffsetSeconds } from "../database/demo.js";
import { addGuardianPoints } from "../database/guardians.js";
import { createReportSession } from "../database/report-session.js";
import { getGuildSettings } from "../database/settings.js";
import { didGuardianEvolve } from "../logic/guardian.js";
import { guardianCard, guardianChoiceMessage } from "../notifications/guardian-card.js";
import { deliverPendingNotifications, NotificationDeliveryInProgressError } from "../notifications/digest.js";
import type { Command } from "./types.js";

// /demo：発表用の操作パネル（1番）。管理者だけが使える
//   ・時間を進める（＋1日／＋4日／＋12日）：アプリの中の「今」（getNow()）を進める
//   ・まとめ通知を今すぐ送る：定時通知・/summary と同じ処理で、設定したチャンネルに送る
//   ・時間を元に戻す／リセット：リセットは記録・妖怪・守り神ポイント・通知を消す（設定と一覧は残る）
//   ・守り神ポイント＋10：押した人の守り神ポイントだけを増やす（進化をすぐ見せるため。観測の記録は増えない）

const DAY_SECONDS = 24 * 60 * 60;
const ADVANCE_DAYS = [1, 4, 12];
const GUARDIAN_BOOST = 10; // 守り神の進化を見せるために、押した人のポイントを増やす量

function formatAppNow(offsetSeconds: number) {
  const now = new Date(Date.now() + offsetSeconds * 1000);
  const text = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const days = Math.floor(offsetSeconds / DAY_SECONDS);
  const hours = Math.floor((offsetSeconds % DAY_SECONDS) / 3600);
  const shift = offsetSeconds === 0 ? "本当の今と同じ" : `本当の今より ${days}日${hours > 0 ? `${hours}時間` : ""} 進んでいる`;
  return `アプリの中の今：**${text}**（${shift}）`;
}

function panel(offsetSeconds: number, notice?: string) {
  const advance = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...ADVANCE_DAYS.map((days) =>
      new ButtonBuilder().setCustomId(`demo:advance:${days}`).setLabel(`＋${days}日`).setStyle(ButtonStyle.Primary),
    ),
    new ButtonBuilder()
      .setCustomId("demo:guardian")
      .setLabel(`守り神ポイント＋${GUARDIAN_BOOST}`)
      .setStyle(ButtonStyle.Primary),
  );
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("demo:summary").setLabel("まとめ通知を今すぐ送る").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("demo:reset-time").setLabel("時間を元に戻す").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("demo:reset").setLabel("リセット").setStyle(ButtonStyle.Danger),
  );
  return {
    content: ["## 🎬 デモ操作", formatAppNow(offsetSeconds), notice ? `\n${notice}` : ""].join("\n"),
    components: [advance, actions],
  };
}

function confirmPanel() {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("demo:reset-confirm").setLabel("消してリセットする").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("demo:cancel").setLabel("やめる").setStyle(ButtonStyle.Secondary),
  );
  return {
    content: [
      "## ⚠️ リセットしますか？",
      "このサーバーの **記録・妖怪・守り神ポイント・まとめ通知の予定** をすべて消し、時間も元に戻します。元に戻せません。",
      "サーバーの設定（チャンネル・時刻・出現回数）と、場所・やり残されていたことの一覧は残ります。",
    ].join("\n"),
    components: [row],
  };
}

// 念のため、コマンドの中でも管理者かどうかを確かめる（Discordの設定で一般メンバーには見えないが、二重に守る）
async function rejectIfNotAdmin(interaction: ChatInputCommandInteraction | MessageComponentInteraction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return false;
  await interaction.reply({
    content: "このコマンドは、サーバー管理の権限を持つ人だけが使えます。",
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

// まとめ通知を、設定したチャンネルに今すぐ送る（送った件数、またはできなかった理由を返す）
async function sendSummaryNow(interaction: ButtonInteraction, offsetSeconds: number) {
  const guildId = interaction.guildId!;
  const settings = await getGuildSettings(guildId);
  if (!settings.notificationChannelId) {
    return "まとめ通知のチャンネルが設定されていません。/youkai-settei で設定してください。";
  }
  const channel = await interaction.client.channels.fetch(settings.notificationChannelId);
  if (!channel?.isSendable()) {
    return "まとめ通知のチャンネルに、ボットが書き込めません。";
  }
  try {
    const count = await deliverPendingNotifications(
      guildId,
      new Date(Date.now() + offsetSeconds * 1000),
      async (messages) => {
        for (const message of messages) await channel.send(message);
      },
    );
    return count === 0
      ? "まだ伝えていない妖怪の変化はありませんでした。"
      : `✅ <#${channel.id}> にまとめ通知を送りました（${count}件）`;
  } catch (error) {
    if (error instanceof NotificationDeliveryInProgressError) {
      return "いま別のところでまとめ通知を送っています。少し待ってから押してください。";
    }
    throw error;
  }
}

// 押した人の守り神ポイントを増やし、守り神のカードを本人にだけ見せる
async function boostGuardian(interaction: ButtonInteraction) {
  const { memberKey } = createReportSession(interaction.guildId!, interaction.user.id);
  const { before, after } = await addGuardianPoints(interaction.guildId!, memberKey, GUARDIAN_BOOST);
  const headline = didGuardianEvolve(before, after.points)
    ? "🛡️ **守り神が進化しました！**"
    : `守り神ポイントが ${GUARDIAN_BOOST} 増えました。`;
  await interaction.followUp({
    ...(after.guardianKey ? guardianCard(after.guardianKey, after.points, headline) : guardianChoiceMessage(after.points)),
    flags: MessageFlags.Ephemeral,
  });
  return `🛡️ 守り神ポイントを ${GUARDIAN_BOOST} 増やしました（${before} → ${after.points}）。観測の記録は増えていません。`;
}

export const demo: Command = {
  data: new SlashCommandBuilder()
    .setName("demo")
    .setDescription("【管理者用・発表用】時間を進める、まとめ通知を今すぐ送る、リセットする")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // サーバー管理の権限がない人には見えない
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (await rejectIfNotAdmin(interaction)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await interaction.editReply(panel(await getTimeOffsetSeconds(interaction.guildId!)));
    } catch (error) {
      console.error("/demo を開けませんでした:", error);
      await interaction.editReply(
        "デモ操作を開けませんでした。データベースに「時間のずれ」の列がまだないかもしれません（sql/migrations/20261024_demo_time_offset.sql）。",
      );
    }
  },

  async handleComponent(interaction) {
    if (!interaction.isButton()) return;
    if (await rejectIfNotAdmin(interaction)) return;
    await interaction.deferUpdate();
    const guildId = interaction.guildId!;
    const [, action, value] = interaction.customId.split(":");

    try {
      if (action === "reset") {
        await interaction.editReply(confirmPanel());
        return;
      }

      let offset = await getTimeOffsetSeconds(guildId);
      let notice: string | undefined;

      if (action === "advance") {
        const days = Number(value);
        offset += days * DAY_SECONDS;
        await setTimeOffsetSeconds(guildId, offset);
        notice = `⏩ ${days}日 進めました。弱った・成仏は、次のまとめ通知で判定されます。`;
      } else if (action === "reset-time") {
        offset = 0;
        await setTimeOffsetSeconds(guildId, 0);
        notice = "⏪ 時間を本当の今に戻しました。";
      } else if (action === "summary") {
        notice = await sendSummaryNow(interaction, offset);
      } else if (action === "guardian") {
        notice = await boostGuardian(interaction);
      } else if (action === "reset-confirm") {
        const result = await resetDemoData(guildId);
        offset = 0;
        notice = `🧹 リセットしました（記録 ${result.reports}件・妖怪 ${result.yokai}体・通知 ${result.notificationJobs}件を消し、時間を元に戻しました）。`;
      } else if (action === "cancel") {
        notice = "リセットはやめました。";
      }

      await interaction.editReply(panel(offset, notice));
    } catch (error) {
      console.error("/demo の操作に失敗しました:", error);
      await interaction.followUp({
        content: "操作できませんでした。少し待ってから、もう一度押してください。続く場合はボットのターミナルを確認してください。",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
