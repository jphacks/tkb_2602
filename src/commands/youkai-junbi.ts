import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type CategoryChannel,
  ChannelType,
  type ChatInputCommandInteraction,
  type Guild,
  InteractionContextType,
  type MessageComponentInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from "discord.js";
import { getLocations, getTaskTypes } from "../database/masters.js";
import { getGuildSettings, saveGuildSettings, saveLocationNames, saveTaskTypeNames } from "../database/settings.js";
import type { Command } from "./types.js";

// /youkai-junbi：はじめての準備（1番）。管理者だけが使える
//   ・3つのチャンネルを作る
//     #お祓い係の控え室（全員。/youkai で観測し、/mamorigami で自分の守り神を見る場所）
//     #毎日報告（全員。毎日のまとめ通知と /summary）
//     #管理者（管理者とボットだけ。ひとこと）
//   ・#毎日報告 と #管理者 を設定に入れる（#お祓い係の控え室 は、カテゴリーの中の名前で探す）
//   ・場所・やり残されていたことの一覧が空なら、初期の一覧を入れる（あとで /youkai-settei で直せる）
// 何度押しても、設定済みで今もあるチャンネルはそのまま使い、二重には作らない

const CATEGORY_NAME = "妖怪だより";
const REPORT_CHANNEL_NAME = "お祓い係の控え室";
const NOTIFY_CHANNEL_NAME = "毎日報告";
const ADMIN_CHANNEL_NAME = "管理者";
const DEFAULT_LOCATIONS = ["流し", "冷蔵庫", "ゴミ箱", "共用机", "実験台"];
const DEFAULT_TASK_TYPES = ["洗い物", "ゴミ出し", "出しっぱなし", "備品の補充", "電気の消し忘れ"];

export function setupButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("youkai-junbi:start").setLabel("準備を始める").setStyle(ButtonStyle.Success),
  );
}

// ボットがサーバーに入ったときに出す案内
export function welcomeMessage() {
  return {
    content: [
      "## 👻 妖怪だよりボットです",
      "研究室の「やり残されていたこと」を、誰も名指しせずに妖怪のしわざとして記録するボットです。",
      "",
      "**管理者の方** が下の「準備を始める」を押すと、次のものを用意します（`/youkai-junbi` でも同じです）。",
      `・#${REPORT_CHANNEL_NAME}：全員が見られるチャンネル。ここで \`/youkai\` で観測し、\`/mamorigami\` で自分の守り神を見ます`,
      `・#${NOTIFY_CHANNEL_NAME}：全員が見られるチャンネル。毎日のまとめ通知が届きます`,
      `・#${ADMIN_CHANNEL_NAME}：管理者とボットだけが見られるチャンネル。「ひとこと」が届きます`,
      "・場所と、やり残されていたことの初期の一覧（あとで `/youkai-settei` で変えられます）",
    ].join("\n"),
    components: [setupButtonRow()],
  };
}

// 設定済みのチャンネルが今もサーバーにあれば、それを使う
async function existingTextChannel(guild: Guild, channelId: string | null) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.type === ChannelType.GuildText ? (channel as TextChannel) : null;
}

async function findOrCreateCategory(guild: Guild): Promise<CategoryChannel> {
  const found = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME,
  ) as CategoryChannel | undefined;
  return found ?? (await guild.channels.create({ name: CATEGORY_NAME, type: ChannelType.GuildCategory }));
}

// /youkai を使う場所の案内（#お祓い係の控え室 を作ったときに1回だけ送る）
const REPORT_GUIDE = [
  "## 👻 ここはお祓い係の控え室です",
  "やり残されていたことに気づいて片づけたら、ここで `/youkai` を使って観測を記録してください。",
  "・返事はあなたにだけ見えます。誰が観測したかは、ほかの人にはわかりません",
  `・同じことが続くと、妖怪が生まれます。妖怪の変化は、毎日決まった時刻に #${NOTIFY_CHANNEL_NAME} でお知らせします`,
  "・`/mamorigami` で、自分の守り神とポイントを見られます（これもあなたにだけ見えます）",
].join("\n");

// 観測のチャンネルは設定に保存しないので、カテゴリーの中から名前で探す。なければ作る
async function findOrCreateReportChannel(guild: Guild, category: CategoryChannel): Promise<string> {
  const found = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === REPORT_CHANNEL_NAME && c.parentId === category.id,
  );
  if (found) return `・観測と守り神：<#${found.id}>（今あるチャンネルをそのまま使います）`;
  const channel = await guild.channels.create({
    name: REPORT_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: "/youkai で観測を記録し、/mamorigami で自分の守り神を見る場所です。返事はあなたにだけ見えます。",
  });
  await channel.send({ content: REPORT_GUIDE, allowedMentions: { parse: [] } });
  return `・観測と守り神：<#${channel.id}> を作りました`;
}

async function setupGuild(guild: Guild, adminUserId: string): Promise<string> {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return [
      "ボットに「チャンネルの管理」の権限がないため、チャンネルを作れませんでした。",
      "サーバー設定 → ロール → このボットのロールで「チャンネルの管理」をオンにしてから、もう一度押してください。",
    ].join("\n");
  }

  const settings = await getGuildSettings(guild.id);
  const lines: string[] = [];
  let category: CategoryChannel | null = null;

  // 1. 観測のチャンネル（全員が見られる。/youkai を使う場所）
  category = await findOrCreateCategory(guild);
  lines.push(await findOrCreateReportChannel(guild, category));

  // 2. まとめ通知のチャンネル（全員が見られる）
  let notify = await existingTextChannel(guild, settings.notificationChannelId);
  if (notify) {
    lines.push(`・まとめ通知：<#${notify.id}>（設定済みのチャンネルをそのまま使います）`);
  } else {
    category ??= await findOrCreateCategory(guild);
    notify = await guild.channels.create({
      name: NOTIFY_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: "毎日決まった時刻に、妖怪の出現や成仏をまとめてお知らせします。誰が記録したかは書きません。",
    });
    lines.push(`・まとめ通知：<#${notify.id}> を作りました`);
  }

  // 3. ひとことのチャンネル（管理者とボットだけが見られる）
  let admin = await existingTextChannel(guild, settings.adminChannelId);
  if (admin) {
    lines.push(`・ひとこと：<#${admin.id}>（設定済みのチャンネルをそのまま使います）`);
  } else {
    category ??= await findOrCreateCategory(guild);
    admin = await guild.channels.create({
      name: ADMIN_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: "観測書の「ひとこと」が届きます。誰が書いたかは届きません。",
      permissionOverwrites: [
        // 一般のメンバーには見えない
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        // ボットは書き込める
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        // ボタンを押した管理者は見られる（サーバーの管理者権限を持つ人は、もともと全部見られる）
        { id: adminUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
      ],
    });
    lines.push(`・ひとこと：<#${admin.id}> を作りました（管理者とボットだけが見られます）`);
  }

  await saveGuildSettings(guild.id, { notificationChannelId: notify.id, adminChannelId: admin.id });

  // 4. 一覧が空なら、初期の一覧を入れる（すでにあるときは触らない）
  const [locations, taskTypes] = await Promise.all([getLocations(guild.id), getTaskTypes(guild.id)]);
  if (locations.length === 0) {
    await saveLocationNames(guild.id, DEFAULT_LOCATIONS);
    lines.push(`・場所の初期の一覧：${DEFAULT_LOCATIONS.join("、")}`);
  }
  if (taskTypes.length === 0) {
    await saveTaskTypeNames(guild.id, DEFAULT_TASK_TYPES);
    lines.push(`・やり残されていたことの初期の一覧：${DEFAULT_TASK_TYPES.join("、")}`);
  }

  return [
    "✅ **準備ができました**",
    ...lines,
    "",
    `メンバーは #${REPORT_CHANNEL_NAME} で \`/youkai\` を使って観測を記録できます。`,
    "まとめ通知の時刻や一覧は `/youkai-settei` で変えられます（今は18:00）。",
  ].join("\n");
}

// 念のため、コマンドの中でも管理者かどうかを確かめる
async function rejectIfNotAdmin(interaction: ChatInputCommandInteraction | MessageComponentInteraction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return false;
  await interaction.reply({
    content: "準備は、サーバー管理の権限を持つ人だけができます。管理者の方に押してもらってください。",
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function runSetup(interaction: ChatInputCommandInteraction | MessageComponentInteraction) {
  if (await rejectIfNotAdmin(interaction)) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.editReply(await setupGuild(interaction.guild!, interaction.user.id));
  } catch (error) {
    console.error("準備に失敗しました:", error);
    await interaction.editReply("準備できませんでした。少し待ってから、もう一度試してください。続く場合はボットのターミナルを確認してください。");
  }
}

export const youkaiJunbi: Command = {
  data: new SlashCommandBuilder()
    .setName("youkai-junbi")
    .setDescription("【管理者用】はじめての準備：チャンネルと初期の一覧を自動で用意します")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild),

  execute: runSetup,

  async handleComponent(interaction) {
    if (interaction.customId === "youkai-junbi:start") await runSetup(interaction);
  },
};
