import {
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
import { birthFrames, isBirth, reportReply } from "../notifications/report-reply.js";
import type { MasterItem } from "../types.js";
import type { Command } from "./types.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BIRTH_FRAME_MS = 2000; // 誕生の演出で、書き換えるまでの間隔

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
    const note = interaction.fields.getTextInputValue("youkai:note");

    if (note) {
      // TODO（1番）：管理者だけが見られるチャンネルにすぐ送る。誰が書いたかは出さない。保存もしない
      //   （送り先のチャンネルは /youkai-settei の設定がつながってから読む）
      console.log(`【管理者に届く予定】「${note}」`);
    }

    // 「一覧にない」を選んだときは記録しない（場所・やり残されていたことのIDがないため）
    // 内容はひとことで管理者に届き、管理者が一覧に足すと、次から記録できるようになる
    if (locationId === OTHER || taskTypeId === OTHER) {
      await interaction.editReply(
        note
          ? "一覧にないものとして、ひとことを管理者に届けます。管理者が一覧に追加すると、次から観測できるようになります。"
          : "一覧にないときは、「ひとこと」に内容を書いてから送ってください。",
      );
      return;
    }

    const guildId = interaction.guildId!;
    try {
      // 報告者IDは、そのままではなく変換した値（memberKey）にしてから渡す。データベースには報告者IDは残らない
      const session = createReportSession(guildId, interaction.user.id);
      const [result, locations, taskTypes] = await Promise.all([
        submitReport({ requestId: session.requestId, guildId, locationId, taskTypeId, memberKey: session.memberKey }),
        getLocations(guildId),
        getTaskTypes(guildId),
      ]);
      const context = {
        locationName: locations.find((l) => l.id === locationId)?.name ?? "（不明な場所）",
        taskTypeName: taskTypes.find((t) => t.id === taskTypeId)?.name ?? "（不明）",
      };
      console.log(`[記録] 回数 ${result.reportCount} / 状態 ${result.stage} / Lv.${result.yokaiLevel}`);

      if (isBirth(result)) {
        // 誕生の演出：気配 → 影 → 姿 と、本人にだけ見える返事を書き換える
        const frames = birthFrames(result, context);
        for (const [i, frame] of frames.entries()) {
          if (i > 0) await sleep(BIRTH_FRAME_MS);
          await interaction.editReply(frame);
        }
      } else {
        await interaction.editReply(reportReply(result, context));
      }
    } catch (error) {
      // 「考え中…」のまま止まらないように、失敗したことを本人に伝える
      console.error("観測の記録に失敗しました:", error);
      await interaction.editReply("記録できませんでした。少し待ってから、もう一度 /youkai を試してください。");
    }
  },
};
