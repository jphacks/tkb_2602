import type { Client, MessageCreateOptions } from "discord.js";
import { getGuildSettings } from "../database/settings.js";
import { isCloudflareConfigured } from "./cloudflare.js";
import { createCustomYokai } from "./custom-yokai.js";

// 新しい「やり残されていたこと」が追加されたら、裏で AI の妖怪を作り始める（待たずに戻る）
// できたら（または作れなかったら）、管理者チャンネルに知らせる。メンバーには見えない
export function startCustomYokaiCreation(client: Client, guildId: string, taskTypeId: string, taskName: string) {
  if (!isCloudflareConfigured()) {
    console.log(`[AI] Cloudflare の設定がないので、「${taskName}」の妖怪は作りません（決まった妖怪のまま）`);
    return;
  }
  void (async () => {
    const settings = await getGuildSettings(guildId).catch(() => null);
    const channel = settings?.adminChannelId ? await client.channels.fetch(settings.adminChannelId).catch(() => null) : null;
    const send = async (message: MessageCreateOptions) => {
      if (channel?.isSendable()) await channel.send(message).catch((e) => console.error("[AI] 管理者チャンネルに送れませんでした:", e));
    };
    try {
      const yokai = await createCustomYokai(guildId, taskTypeId, taskName);
      await send({
        content: `🎨 「${taskName}」のための妖怪を、AI（Cloudflare Workers AI）で作りました。次に出現するときから、この姿で現れます。`,
        embeds: [{ title: yokai.name, color: 0x695099, image: { url: `attachment://${yokai.imageKey}` } }],
        files: [{ attachment: yokai.birthPath, name: yokai.imageKey }],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`[AI] 「${taskName}」の妖怪を作れませんでした:`, error);
      await send({
        content: `⚠️ 「${taskName}」のための妖怪を AI で作れませんでした（無料の範囲を超えたか、通信の問題かもしれません）。決まった妖怪のまま出現します。`,
        allowedMentions: { parse: [] },
      });
    }
  })();
}
