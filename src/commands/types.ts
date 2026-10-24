import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

// コマンド1つ分のまとまり（1番）
// ボタン・選択メニュー・モーダルの customId は「コマンド名:〇〇」で始める決まりにする
// （例：youkai:modal）。index.ts は先頭のコマンド名を見て、どのコマンドに渡すかを決める
export type Command = {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  handleModal?(interaction: ModalSubmitInteraction): Promise<void>;
  handleComponent?(interaction: MessageComponentInteraction): Promise<void>;
};
