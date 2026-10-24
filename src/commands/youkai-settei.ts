import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getLocations, getTaskTypes } from "../database/masters.js";
import {
  getGuildSettings,
  saveGuildSettings,
  saveLocationNames,
  saveTaskTypeNames,
} from "../database/settings.js";
import type { Command } from "./types.js";

// /youkai-settei：管理者用の設定（1番）
//   1枚目のモーダル：まとめ通知のチャンネル・管理者のチャンネル・まとめ通知の時刻・何度目に妖怪が出現するか・場所の一覧
//   2枚目のモーダル：やり残されていたことの一覧（モーダルは1枚に5項目までなので分ける）
// 開くたびに今の設定が入った状態で開くので、直したいところだけ書き換えればよい

const MAX_NAME_LENGTH = 50;

// 「1行に1つ」で書かれた一覧を名前の配列にする。空行と重複は取り除く
function parseList(text: string) {
  const names = [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  const errors: string[] = [];
  if (names.length === 0) errors.push("1つ以上書いてください");
  const tooLong = names.filter((name) => name.length > MAX_NAME_LENGTH);
  if (tooLong.length > 0) errors.push(`${MAX_NAME_LENGTH}文字までにしてください：${tooLong.join("、")}`);
  return { names, errors };
}

// 今の一覧と比べて、何が増えて何が使われなくなるかを文章にする
function describeChanges(before: string[], after: string[]) {
  const added = after.filter((name) => !before.includes(name));
  const removed = before.filter((name) => !after.includes(name));
  const lines = [`一覧：${after.join("、")}`];
  if (added.length > 0) lines.push(`追加：${added.join("、")}`);
  if (removed.length > 0) lines.push(`使わなくなる：${removed.join("、")}（これまでの記録は残ります）`);
  return lines.join("\n");
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

function hourOptions(current: number) {
  return Array.from({ length: 24 }, (_, hour) => ({
    label: `${hour}時`,
    value: String(hour),
    default: hour === current,
  }));
}

function thresholdOptions(current: number) {
  return Array.from({ length: 9 }, (_, i) => i + 2).map((count) => ({
    label: `${count}度目`,
    value: String(count),
    default: count === current,
  }));
}

function channelMenu(customId: string, placeholder: string, current: string | null) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addChannelTypes(ChannelType.GuildText);
  if (current) menu.setDefaultChannels(current);
  return menu;
}

function listInput(customId: string, names: string[], placeholder: string) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(placeholder)
    .setMaxLength(2000);
  if (names.length > 0) input.setValue(names.join("\n"));
  return input;
}

export const youkaiSettei: Command = {
  data: new SlashCommandBuilder()
    .setName("youkai-settei")
    .setDescription("【管理者用】場所の一覧・まとめ通知・妖怪が出現するタイミングなどを設定します")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // サーバー管理の権限がない人には見えない
    .setContexts(InteractionContextType.Guild), // サーバーの中でだけ使える

  // 1枚目のモーダルを開く（3秒以内に開く必要があるので、今の設定は並べて同時に読む）
  async execute(interaction) {
    if (await rejectIfNotAdmin(interaction)) return;
    const guildId = interaction.guildId!;
    const [settings, locations] = await Promise.all([getGuildSettings(guildId), getLocations(guildId)]);

    const modal = new ModalBuilder()
      .setCustomId("youkai-settei:basic")
      .setTitle("妖怪ボットの設定（1/2）")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("まとめ通知を送るチャンネル")
          .setDescription("研究室の全員がいるチャンネル。その日に出現した妖怪などを毎日まとめて送ります")
          .setChannelSelectMenuComponent(
            channelMenu("youkai-settei:notify", "例：#妖怪だより", settings.notificationChannelId),
          ),
        new LabelBuilder()
          .setLabel("「ひとこと」を届けるチャンネル")
          .setDescription("管理者だけが見られるチャンネル。ひとことは書かれたらすぐに届きます")
          .setChannelSelectMenuComponent(
            channelMenu("youkai-settei:admin", "例：#管理者", settings.adminChannelId),
          ),
        new LabelBuilder().setLabel("まとめ通知を送る時刻").setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("youkai-settei:hour")
            .addOptions(hourOptions(settings.digestHour)),
        ),
        new LabelBuilder()
          .setLabel("何度目に妖怪が出現するか")
          .setDescription("同じ場所×やり残されていたことが、この回数目に記録されたときに妖怪が生まれます")
          .setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
              .setCustomId("youkai-settei:threshold")
              .addOptions(thresholdOptions(settings.birthThreshold)),
          ),
        new LabelBuilder()
          .setLabel("場所の一覧（1行に1つ）")
          .setDescription("消した場所は「使わない」状態になり、記録は残ります")
          .setTextInputComponent(
            listInput("youkai-settei:locations", locations.map((l) => l.name), "流し\n冷蔵庫\nコピー機"),
          ),
      );

    await interaction.showModal(modal);
  },

  async handleModal(interaction) {
    if (interaction.customId === "youkai-settei:basic") return saveBasic(interaction);
    if (interaction.customId === "youkai-settei:tasks") return saveTasks(interaction);
  },

  // 「次へ」ボタン → 2枚目のモーダルを開く
  async handleComponent(interaction) {
    if (interaction.customId !== "youkai-settei:open-tasks") return;
    if (await rejectIfNotAdmin(interaction)) return;
    const taskTypes = await getTaskTypes(interaction.guildId!);

    const modal = new ModalBuilder()
      .setCustomId("youkai-settei:tasks")
      .setTitle("妖怪ボットの設定（2/2）")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("やり残されていたことの一覧（1行に1つ）")
          .setDescription("それぞれに妖怪が1体ずつ対応します")
          .setTextInputComponent(
            listInput("youkai-settei:task-list", taskTypes.map((t) => t.name), "洗い物\nゴミ出し\n備品の補充"),
          ),
      );

    await interaction.showModal(modal);
  },
};

// 1枚目の保存
async function saveBasic(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId!;

  const notifyChannel = interaction.fields.getSelectedChannels("youkai-settei:notify", true).first()!;
  const adminChannel = interaction.fields.getSelectedChannels("youkai-settei:admin", true).first()!;
  const digestHour = Number(interaction.fields.getStringSelectValues("youkai-settei:hour")[0]);
  const birthThreshold = Number(interaction.fields.getStringSelectValues("youkai-settei:threshold")[0]);
  const { names, errors } = parseList(interaction.fields.getTextInputValue("youkai-settei:locations"));

  if (errors.length > 0) {
    await interaction.editReply(`場所の一覧を直してください：\n・${errors.join("\n・")}\nもう一度 /youkai-settei を開いてください。`);
    return;
  }

  const before = (await getLocations(guildId)).map((l) => l.name);
  await saveGuildSettings(guildId, {
    notificationChannelId: notifyChannel.id,
    adminChannelId: adminChannel.id,
    digestHour,
    birthThreshold,
  });
  await saveLocationNames(guildId, names);

  const next = new ButtonBuilder()
    .setCustomId("youkai-settei:open-tasks")
    .setLabel("次へ：やり残されていたことの一覧")
    .setStyle(ButtonStyle.Primary);

  await interaction.editReply({
    content: [
      "**設定（1/2）**（※ まだ保存はされません）",
      `まとめ通知：<#${notifyChannel.id}> に毎日 ${digestHour}時`,
      `ひとことの届け先：<#${adminChannel.id}>（書かれたらすぐに届きます）`,
      `何度目に妖怪が出現するか：${birthThreshold}度目`,
      "",
      `**場所**`,
      describeChanges(before, names),
    ].join("\n"),
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(next)],
  });
}

// 2枚目の保存
async function saveTasks(interaction: ModalSubmitInteraction) {
  // 「次へ」ボタンのメッセージから開いたモーダルなので、そのメッセージを書き換える
  if (!interaction.isFromMessage()) return;
  await interaction.deferUpdate();
  const guildId = interaction.guildId!;

  const { names, errors } = parseList(interaction.fields.getTextInputValue("youkai-settei:task-list"));
  if (errors.length > 0) {
    await interaction.followUp({
      content: `やり残されていたことの一覧を直してください：\n・${errors.join("\n・")}\nもう一度「次へ」を押してください。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const before = (await getTaskTypes(guildId)).map((t) => t.name);
  await saveTaskTypeNames(guildId, names);

  await interaction.editReply({
    content: [
      interaction.message.content,
      "",
      "**やり残されていたこと**",
      describeChanges(before, names),
      "",
      "✅ 設定が終わりました（※ まだ保存はされません）",
    ].join("\n"),
    components: [],
  });
}
