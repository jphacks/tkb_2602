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
import type { MasterItem } from "../types.js";
import type { Command } from "./types.js";

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
      // TODO（1番）：管理者だけが見られる場所に送る。誰が書いたかは出さない。保存もしない
      console.log(`【管理者に届く予定】「${note}」`);
    }

    // TODO：ここで報告を保存し（2番）、ゲームのルールで判定して（3番）、表示を作る（4番）
    //   ReportInput（types.ts）の形にまとめて渡す。reportedAt には getNow() を入れる
    console.log(`[報告] 場所 ${locationId} / 雑務 ${taskTypeId}`);

    await interaction.editReply("受け付けました（まだ保存はしていません）");
  },
};
