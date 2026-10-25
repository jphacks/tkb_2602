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

test("片づけた人が3人未満、または合計が10未満なら出さない（誰のことか分かってしまうため）", () => {
  assert.equal(bias.biasStage([20, 20], 10), "unknown");
  assert.equal(bias.biasStage([3, 2, 2], 10), "unknown");
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
