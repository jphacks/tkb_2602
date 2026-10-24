import { Client, Events, GatewayIntentBits } from "discord.js";
import { commands } from "./commands/index.js";
import { discordGuildId, discordToken } from "./config.js";
import { welcomeMessage } from "./commands/youkai-junbi.js";
import { getLocations } from "./database/masters.js";
import { startNotificationScheduler } from "./notifications/digest.js";

// ボットの起動と、届いたインタラクションの振り分け（1番だけが編集する）
// ほかの担当は、それぞれのフォルダに関数を作って渡すだけにする

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const byName = new Map(commands.map((command) => [command.data.name, command]));

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`ログインしました: ${readyClient.user.tag}`);

  // 起動時に1回 Supabase に問い合わせて、通信の準備を先に済ませる（最初のコマンドが遅くならないように）
  const start = Date.now();
  try {
    const locations = await getLocations(discordGuildId);
    console.log(`Supabase につながりました（${Date.now() - start}ms、場所 ${locations.length}件）`);
  } catch (error) {
    console.error("Supabase につながりませんでした:", error);
  }

  startNotificationScheduler(readyClient);
});

// 新しいサーバーに招待されたら、準備の案内を出す（チャンネルは管理者がボタンを押してから作る）
client.on(Events.GuildCreate, async (guild) => {
  try {
    const me = await guild.members.fetchMe();
    // サーバーの「システムメッセージ」のチャンネル。なければ、ボットが書き込める最初のテキストチャンネル
    const channel =
      (guild.systemChannel?.permissionsFor(me).has("SendMessages") ? guild.systemChannel : null) ??
      (await guild.channels.fetch()).find(
        (c) => c?.isTextBased() && !c.isThread() && c.permissionsFor(me).has(["ViewChannel", "SendMessages"]),
      );
    if (channel?.isSendable()) await channel.send(welcomeMessage());
    console.log(`新しいサーバーに入りました: ${guild.name}（${channel ? "案内を送りました" : "案内を送れるチャンネルがありません"}）`);
  } catch (error) {
    console.error("新しいサーバーへの案内に失敗しました:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  const delay = Date.now() - interaction.createdTimestamp;
  try {
    if (interaction.isChatInputCommand()) {
      await byName.get(interaction.commandName)?.execute(interaction);
    } else if (interaction.isModalSubmit()) {
      // customId の先頭（「youkai:modal」なら youkai）で、どのコマンドの部品かを見分ける
      await byName.get(interaction.customId.split(":")[0])?.handleModal?.(interaction);
    } else if (interaction.isMessageComponent()) {
      await byName.get(interaction.customId.split(":")[0])?.handleComponent?.(interaction);
    }
  } catch (error) {
    // 失敗してもボットは止めずに、内容だけ表示する
    console.error(`処理に失敗しました（受信までの遅れ: ${delay}ms）`, error);
  }
});

client.on(Events.Error, (error) => {
  console.error("エラーが発生しました:", error);
});

client.login(discordToken);
