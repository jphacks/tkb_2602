// テスト用のデータを Supabase に入れるスクリプト（npm run seed）
// .env.local の DISCORD_GUILD_ID のサーバーの分だけ入れる。何回実行しても二重には入らない
import { discordGuildId as guildId } from "../src/config.js";
import { supabase } from "../src/database/client.js";

// ↓ 入れたい名前は、ここを書き換えれば変えられる
const LOCATIONS = ["流し", "冷蔵庫", "コピー機"];
const TASK_TYPES = ["洗い物", "ゴミ出し", "備品の補充"];

// 1. サーバーを登録する（すでにあれば、設定は書き換えずにそのまま）
const settings = await supabase
  .from("guild_settings")
  .upsert({ guild_id: guildId }, { onConflict: "guild_id", ignoreDuplicates: true });
if (settings.error) throw settings.error;
console.log(`guild_settings：サーバー ${guildId} を登録しました（すでにあればそのまま）`);

// 2. 場所と雑務を、まだない名前だけ足す
async function addMissing(table: "locations" | "task_types", names: string[]) {
  const existing = await supabase.from(table).select("name").eq("guild_id", guildId);
  if (existing.error) throw existing.error;

  const have = new Set(existing.data.map((row) => row.name as string));
  const missing = names.filter((name) => !have.has(name));
  if (missing.length > 0) {
    const inserted = await supabase
      .from(table)
      .insert(missing.map((name) => ({ guild_id: guildId, name })));
    if (inserted.error) throw inserted.error;
  }
  console.log(`${table}：${missing.length}件追加（すでにあった ${names.length - missing.length}件はそのまま）`);
}

await addMissing("locations", LOCATIONS);
await addMissing("task_types", TASK_TYPES);
console.log("完了しました");
