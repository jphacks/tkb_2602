import {
  type ButtonInteraction,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getLocations, getTaskTypes } from "../database/masters.js";
import {
  getPendingObservation,
  resolvePendingObservation,
} from "../database/pending-observations.js";
import { submitReport } from "../database/reports.js";
import { saveLocationNames, saveTaskTypeNames } from "../database/settings.js";
import { getTimeOffsetMs } from "../time.js";

// 管理者チャンネルの「この内容を選択肢に追加する」ボタン（1番）
//   ボタン → 新しい名前を入れるフォーム → 選択肢に追加し、最初の「一覧にない」観測を1回目として数える
// customId：youkai-settei:pending-add:<id>（ボタン）、youkai-settei:pending-modal:<id>（フォーム）

const MAX_NAME_LENGTH = 50;

function nameInput(customId: string, placeholder: string) {
  return new TextInputBuilder()
    .setCustomId(customId)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(MAX_NAME_LENGTH)
    .setPlaceholder(placeholder);
}

// ボタンが押されたら、足りない名前（場所・やり残されていたこと）を入れるフォームを開く
export async function openPendingAddModal(interaction: ButtonInteraction, pendingId: string) {
  const pending = await getPendingObservation(interaction.guildId!, pendingId);
  if (!pending || pending.resolved) {
    await interaction.reply({
      content: pending ? "この観測は、もう選択肢に追加して数えてあります。" : "この観測が見つかりませんでした（リセットされた可能性があります）。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`youkai-settei:pending-modal:${pendingId}`)
    .setTitle("選択肢に追加する");
  if (pending.locationId === null) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("新しい場所の名前")
        .setDescription("ひとことを読んで、ほかの人にも伝わる短い名前にしてください")
        .setTextInputComponent(nameInput("pending:location", "例：プリンター")),
    );
  }
  if (pending.taskTypeId === null) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("新しいやり残されていたことの名前")
        .setDescription("ひとことを読んで、ほかの人にも伝わる短い名前にしてください。人の名前は入れないでください")
        .setTextInputComponent(nameInput("pending:task", "例：紙詰まり")),
    );
  }
  await interaction.showModal(modal);
}

function cleanName(raw: string) {
  const name = raw.trim();
  if (!name) throw new Error("名前を入れてください");
  if (name.length > MAX_NAME_LENGTH || /[\r\n]/.test(name)) throw new Error(`名前は改行なしの${MAX_NAME_LENGTH}文字以内にしてください`);
  return name;
}

// 一覧になければ足して、その名前のIDを返す（すでにあれば、そのIDを使う）
async function ensureItem(
  guildId: string,
  name: string,
  list: (guildId: string) => Promise<{ id: string; name: string }[]>,
  save: (guildId: string, names: string[]) => Promise<void>,
) {
  const items = await list(guildId);
  const found = items.find((item) => item.name === name);
  if (found) return { id: found.id, added: false };
  await save(guildId, [...items.map((item) => item.name), name]);
  const created = (await list(guildId)).find((item) => item.name === name);
  if (!created) throw new Error("追加した選択肢が見つかりませんでした");
  return { id: created.id, added: true };
}

// フォームが送られたら、選択肢に追加して、最初の観測を1回目として数える
export async function submitPendingAdd(interaction: ModalSubmitInteraction, pendingId: string) {
  if (!interaction.isFromMessage()) return;
  await interaction.deferUpdate();
  const guildId = interaction.guildId!;

  try {
    const pending = await getPendingObservation(guildId, pendingId);
    if (!pending || pending.resolved) {
      await interaction.followUp({ content: "この観測は、もう数えてあるか、見つかりませんでした。", flags: MessageFlags.Ephemeral });
      return;
    }

    const lines: string[] = [];
    let locationId = pending.locationId;
    let taskTypeId = pending.taskTypeId;
    if (locationId === null) {
      const name = cleanName(interaction.fields.getTextInputValue("pending:location"));
      const result = await ensureItem(guildId, name, getLocations, saveLocationNames);
      locationId = result.id;
      lines.push(result.added ? `場所に「${name}」を追加しました` : `場所「${name}」はもう一覧にあったので、それを使いました`);
    }
    if (taskTypeId === null) {
      const name = cleanName(interaction.fields.getTextInputValue("pending:task"));
      const result = await ensureItem(guildId, name, getTaskTypes, saveTaskTypeNames);
      taskTypeId = result.id;
      lines.push(result.added ? `やり残されていたことに「${name}」を追加しました` : `「${name}」はもう一覧にあったので、それを使いました`);
    }

    // 最初の観測を記録する。request_id に追加待ちのIDを使うので、二度押しても1回しか数えない
    const offsetMs = await getTimeOffsetMs(guildId);
    const result = await submitReport({
      requestId: pending.id,
      guildId,
      locationId,
      taskTypeId,
      memberKey: pending.memberKey,
      now: offsetMs > 0 ? new Date(Date.now() + offsetMs) : undefined,
    });
    await resolvePendingObservation(guildId, pending.id, new Date(Date.now() + offsetMs));
    console.log(`[追加待ち→記録] 回数 ${result.reportCount} / 状態 ${result.stage}`);

    // 管理者チャンネルのメッセージからボタンを外し、何をしたかを書き足す
    await interaction.editReply({
      content: `${interaction.message.content}\n\n✅ ${lines.join("／")}。最初の観測を **1回目** として数えました。`,
      components: [],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error("選択肢に追加できませんでした:", error);
    const message = error instanceof Error && /名前/.test(error.message) ? error.message : "追加できませんでした。少し待ってから、もう一度押してください。";
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}
