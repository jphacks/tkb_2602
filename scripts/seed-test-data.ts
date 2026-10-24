// テスト用のデータを Supabase に入れるスクリプト（npm run seed）
// .env.local の DISCORD_GUILD_ID のサーバーの分だけ入れる。何回実行しても二重には入らない
import { discordGuildId as guildId } from "../src/config.js";
import { supabase } from "../src/database/client.js";

// ↓ 入れたい名前は、ここを書き換えれば変えられる
const LOCATIONS = [{ name: "流し" }, { name: "冷蔵庫" }, { name: "コピー機" }];
// 雑務には、対応する妖怪（yokai_key）が必要。どの雑務にどの妖怪を対応させるかは未決定なので、仮の割り当て
const TASK_TYPES = [
  { name: "洗い物", yokai_key: "Y01" },
  { name: "ゴミ出し", yokai_key: "Y02" },
  { name: "備品の補充", yokai_key: "Y03" },
];

// 1. サーバーを登録する（すでにあれば、設定は書き換えずにそのまま）
const settings = await supabase
  .from("guild_settings")
  .upsert({ guild_id: guildId }, { onConflict: "guild_id", ignoreDuplicates: true });
if (settings.error) throw settings.error;
console.log(`guild_settings：サーバー ${guildId} を登録しました（すでにあればそのまま）`);

// 2. 場所と雑務を、まだない名前だけ足す
async function addMissing(table: "locations" | "task_types", rows: { name: string }[]) {
  const existing = await supabase.from(table).select("name").eq("guild_id", guildId);
  if (existing.error) throw existing.error;

  const have = new Set(existing.data.map((row) => row.name as string));
  const missing = rows.filter((row) => !have.has(row.name));
  if (missing.length > 0) {
    const inserted = await supabase
      .from(table)
      .insert(missing.map((row) => ({ guild_id: guildId, ...row })));
    if (inserted.error) throw inserted.error;
  }
  console.log(`${table}：${missing.length}件追加（すでにあった ${rows.length - missing.length}件はそのまま）`);
}

await addMissing("locations", LOCATIONS);
await addMissing("task_types", TASK_TYPES);
console.log("完了しました");
