// すでに一覧にある「やり残されていたこと」のために、AI で妖怪を作るスクリプト
//   npm run make-custom-yokai 紙詰まり
// .env.local の DISCORD_GUILD_ID のサーバーの項目が対象。Cloudflare の設定と、20261024_custom_yokai.sql の反映が必要
import { createCustomYokai } from "../src/ai/custom-yokai.js";
import { isCloudflareConfigured } from "../src/ai/cloudflare.js";
import { discordGuildId } from "../src/config.js";
import { getTaskTypes } from "../src/database/masters.js";

const taskName = process.argv[2];
if (!taskName) throw new Error("項目の名前を付けてください（例：npm run make-custom-yokai 紙詰まり）");
if (!isCloudflareConfigured()) throw new Error("CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN を .env.local に入れてください");

const task = (await getTaskTypes(discordGuildId)).find((t) => t.name === taskName);
if (!task) throw new Error(`「${taskName}」は一覧にありません`);

const yokai = await createCustomYokai(discordGuildId, task.id, task.name);
console.log(`できました：${yokai.name}\n  ${yokai.birthPath}\n  ${yokai.ascendPath}`);
process.exit(0);
