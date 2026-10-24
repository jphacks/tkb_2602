import {
  type Client,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getLocations, getTaskTypes } from "../database/masters.js";
import { createReportSession } from "../database/report-session.js";
import { submitReport } from "../database/reports.js";
import { getYokaiIdentity } from "../database/yokai.js";
import { getGuildSettings } from "../database/settings.js";
import { type AdminNoteContext, adminNoteMessage } from "../notifications/admin-note.js";
import { birthFrames, evolutionReply, isBirth, isEvolution, reportReply } from "../notifications/report-reply.js";
import { getTimeOffsetMs } from "../time.js";
import type { MasterItem } from "../types.js";
import type { Command } from "./types.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BIRTH_FRAME_MS = 2000; // 誕生の演出で、書き換えるまでの間隔

// ひとことを管理者チャンネルにすぐ送る。送れたら true
// 誰が書いたかは出さず、データベースにも保存しない
async function sendAdminNote(client: Client, channelId: string | null, context: AdminNoteContext) {
  if (!channelId) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable()) return false;
    await channel.send({
      content: adminNoteMessage(context),
      allowedMentions: { parse: [] }, // ひとことに @everyone などが書かれていても、誰にも通知が飛ばないようにする
    });
    return true;
  } catch (error) {
    console.error("ひとことを管理者チャンネルに送れませんでした:", error);
    return false;
  }
}

// /youkai：妖怪観測書（1番）。やり残されていたこと（＝妖怪のしわざ）を見つけて片づけたことを記録する
// A案：モーダルの中に「場所」「やり残されていたこと」の選択メニューと「ひとこと」を置く
// ※ モーダルは最初の返事なので deferReply できない。一覧の取得を含めて3秒以内に開く必要がある

const OTHER = "other"; // 「一覧にない」を選んだときの値
const OTHER_LABEL = "一覧にない（下の「ひとこと」に記入してください）";

// Discordの選択メニューは25個まで。「一覧にない」の分を1つ空けておく
function toOptions(items: MasterItem[]) {
  return [
    ...items.slice(0, 24).map((item) => ({ label: item.name, value: item.id })),
    { label: OTHER_LABEL, value: OTHER },
  ];
}

export const youkai: Command = {
  data: new SlashCommandBuilder().setName("youkai").setDescription("やり残されていたことを記録して、妖怪を観測します"),

  async execute(interaction) {
    const received = Date.now() - interaction.createdTimestamp;
    const fetchStart = Date.now();
    const [locations, taskTypes] = await Promise.all([
      getLocations(interaction.guildId!),
      getTaskTypes(interaction.guildId!),
    ]);
    const fetchMs = Date.now() - fetchStart;

    const modal = new ModalBuilder()
      .setCustomId("youkai:modal")
      .setTitle("妖怪観測書")
      .addLabelComponents(
        new LabelBuilder().setLabel("場所").setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("youkai:location")
            .setPlaceholder("場所を選んでください")
            .addOptions(toOptions(locations)),
        ),
        new LabelBuilder().setLabel("やり残されていたこと").setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("youkai:task")
            .setPlaceholder("やり残されていたことを選んでください")
            .addOptions(toOptions(taskTypes)),
        ),
        new LabelBuilder()
          .setLabel("ひとこと")
          .setDescription("管理者だけに届き、公開されません")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId("youkai:note")
              .setStyle(TextInputStyle.Short)
              .setMaxLength(50)
              .setRequired(false),
          ),
      );

    await interaction.showModal(modal);

    // 計測：3秒に間に合っているかを確かめる（A案で大丈夫か判断するため）
    const total = Date.now() - interaction.createdTimestamp;
    console.log(
      `[計測] /youkai 受信まで ${received}ms ＋ Supabase ${fetchMs}ms → モーダルまで合計 ${total}ms` +
        (total > 2500 ? " ⚠️ 3秒に近い" : ""),
    );
  },

  async handleModal(interaction) {
    // ここから先はデータベースを使うので、先に「考え中…」を出す（本人にだけ見える）
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const locationId = interaction.fields.getStringSelectValues("youkai:location")[0];
    const taskTypeId = interaction.fields.getStringSelectValues("youkai:task")[0];
    const note = interaction.fields.getTextInputValue("youkai:note").trim();
    const guildId = interaction.guildId!;
    const isOther = locationId === OTHER || taskTypeId === OTHER;

    // 「一覧にない」なのにひとことがないときは、何を見つけたのかわからないので書いてもらう
    if (isOther && !note) {
      await interaction.editReply("一覧にないときは、「ひとこと」に内容を書いてから、もう一度 /youkai を送ってください。");
      return;
    }

    try {
      const [locations, taskTypes, settings] = await Promise.all([
        getLocations(guildId),
        getTaskTypes(guildId),
        getGuildSettings(guildId),
      ]);
      const context = {
        locationName:
          locationId === OTHER ? "一覧にない" : (locations.find((l) => l.id === locationId)?.name ?? "（不明な場所）"),
        taskTypeName:
          taskTypeId === OTHER ? "一覧にない" : (taskTypes.find((t) => t.id === taskTypeId)?.name ?? "（不明）"),
      };

      // ひとことは、記録の結果を待たずにすぐ管理者に届ける
      const noteSent = note
        ? await sendAdminNote(interaction.client, settings.adminChannelId, { ...context, note })
        : false;
      const noteLine = !note
        ? ""
        : noteSent
          ? "\n-# ひとことを管理者に届けました"
          : "\n-# ひとことを管理者に届けられませんでした（管理者チャンネルが設定されていないか、ボットが書き込めません）";

      // 「一覧にない」を選んだときは記録しない（場所・やり残されていたことのIDがないため）
      // 管理者が一覧に足すと、次から記録できるようになる
      if (isOther) {
        await interaction.editReply(
          (noteSent
            ? "一覧にないものとして、ひとことを管理者に届けました。管理者が一覧に追加すると、次から観測できるようになります。"
            : "一覧にないものとして受け付けましたが、ひとことを管理者に届けられませんでした（管理者チャンネルが設定されていないか、ボットが書き込めません）。管理者に知らせてください。"),
        );
        return;
      }

      // 報告者IDは、そのままではなく変換した値（memberKey）にしてから渡す。データベースには報告者IDは残らない
      const session = createReportSession(guildId, interaction.user.id);
      // /demo で時間を進めているときは、アプリの中の「今」で記録する
      const offsetMs = await getTimeOffsetMs(guildId);
      const result = await submitReport({
        requestId: session.requestId,
        guildId,
        locationId,
        taskTypeId,
        memberKey: session.memberKey,
        now: offsetMs > 0 ? new Date(Date.now() + offsetMs) : undefined,
      });
      console.log(`[記録] 回数 ${result.reportCount} / 状態 ${result.stage} / Lv.${result.yokaiLevel}`);

      if (isBirth(result) || isEvolution(result)) {
        // 妖怪の名前と画像（submit_report が保存したもの）。取れなくても、文字だけで返事は出す
        const identity = await getYokaiIdentity(guildId, result.yokaiId).catch((error) => {
          console.error("妖怪の名前と画像を取得できませんでした:", error);
          return { yokaiName: null, imageKey: null };
        });
        if (isBirth(result)) {
          // 誕生の演出：気配 → 影 → 姿 と、本人にだけ見える返事を書き換える（最後に名前と画像）
          const frames = birthFrames(result, context, identity);
          for (const [i, frame] of frames.entries()) {
            if (i > 0) await sleep(BIRTH_FRAME_MS);
            await interaction.editReply(i === frames.length - 1 ? { ...frame, content: frame.content + noteLine } : frame);
          }
        } else {
          const reply = evolutionReply(result, context, identity);
          await interaction.editReply({ ...reply, content: reply.content + noteLine });
        }
      } else {
        await interaction.editReply(reportReply(result, context) + noteLine);
      }
    } catch (error) {
      // 「考え中…」のまま止まらないように、失敗したことを本人に伝える
      console.error("観測の記録に失敗しました:", error);
      await interaction.editReply("記録できませんでした。少し待ってから、もう一度 /youkai を試してください。");
    }
  },
};
