import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

Object.assign(process.env, {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN ?? "test-token",
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ?? "111111111111111111",
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID ?? "222222222222222222",
  SUPABASE_URL: process.env.SUPABASE_URL ?? "https://example.supabase.co",
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? "test-only-secret",
});

const bias = await import(pathToFileURL(resolve("src/logic/bias.ts")).href);
const digest = await import(pathToFileURL(resolve("src/notifications/digest.ts")).href);

test("みんなで同じくらい片づけていれば、健全", () => {
  // 9人中9人が同じだけ
  assert.equal(bias.biasStage([5, 5, 5, 5, 5, 5, 5, 5, 5], 9), "healthy");
});

test("9人の研究室で、1人が2割以上なら気配、1/3以上ならかたより坊が出現", () => {
  assert.equal(bias.biasStage([6, 3, 3, 3, 3, 3, 3], 9), "presence"); // 6/24 = 25%
  assert.equal(bias.biasStage([11, 5, 5, 5, 5], 9), "active"); // 11/31 ≒ 35%
});

test("片づけない人も人数に入れる（2人だけが半分ずつでも、10人の研究室なら偏り）", () => {
  assert.equal(bias.biasStage([10, 10, 1], 10), "active");
});

test("片づけた人が3人未満、または合計が6未満なら出さない（誰のことか分かってしまうため）", () => {
  assert.equal(bias.biasStage([20, 20], 10), "unknown");
  assert.equal(bias.biasStage([2, 2, 1], 10), "unknown");
});

test("妖怪だよりには段階だけを出し、人数や割合は出さない", () => {
  const job = { id: "1", eventType: "presence", yokaiId: null, yokaiName: null, imageKey: null };
  const active = digest.formatNotificationDigest([job], "active");
  assert.match(active, /かたより坊が現れました/);
  assert.match(active, /話し合って/);
  assert.doesNotMatch(active, /\d+%|\d+人/);
  assert.match(digest.formatNotificationDigest([job], "presence"), /かたより坊の気配/);
  assert.doesNotMatch(digest.formatNotificationDigest([job], "healthy"), /かたより坊/);
  assert.doesNotMatch(digest.formatNotificationDigest([job]), /かたより坊/);
});

test("自分が担った割合は、10%きざみで本人にだけ", () => {
  assert.equal(bias.myShareText(3, 10), "この研究室の片づけのうち、あなたが担ったのは約30%です");
  assert.equal(bias.myShareText(1, 100), "この研究室の片づけのうち、あなたが担ったのは1割未満です");
  assert.equal(bias.myShareText(0, 10), null);
});

test("かたより坊は、直近の片づけ（最後にポイントが付いた時刻が since 以降）だけを、人ごとの数にして使う", async () => {
  const originalFetch = globalThis.fetch;
  let query;
  globalThis.fetch = async (input, init) => {
    const url = new URL(new Request(input, init).url);
    query = url.searchParams;
    assert.equal(url.pathname.split("/").at(-1), "guardian_cooldowns");
    return new Response(JSON.stringify([
      { member_key: "a" }, { member_key: "a" }, { member_key: "a" }, { member_key: "b" }, { member_key: "c" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const guardians = await import(pathToFileURL(resolve("src/database/guardians.ts")).href);
    const since = new Date("2030-01-01T00:00:00Z");
    const counts = await guardians.getRecentCleaningCounts("guild-1", since);
    assert.deepEqual(counts.sort(), [1, 1, 3]);
    assert.equal(query.get("last_awarded_at"), `gte.${since.toISOString()}`);
    assert.equal(query.get("select"), "member_key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
