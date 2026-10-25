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

const celebration = await import(pathToFileURL(resolve("src/logic/celebration.ts")).href);
const digest = await import(pathToFileURL(resolve("src/notifications/digest.ts")).href);

const now = new Date("2030-01-14T09:00:00Z");
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

test("新しい妖怪が7日以上生まれず、今いる妖怪もいなければ、静かな1週間として祝う", () => {
  assert.equal(celebration.isQuietWeek({ activeCount: 0, lastBornAt: daysAgo(7) }, now), true);
  assert.equal(celebration.isQuietWeek({ activeCount: 0, lastBornAt: daysAgo(30) }, now), true);
});

test("妖怪がいる、または最近生まれたときは祝わない", () => {
  assert.equal(celebration.isQuietWeek({ activeCount: 1, lastBornAt: daysAgo(30) }, now), false);
  assert.equal(celebration.isQuietWeek({ activeCount: 0, lastBornAt: daysAgo(6) }, now), false);
});

test("一度も妖怪が生まれていない（使い始めていない）研究室では祝わない", () => {
  assert.equal(celebration.isQuietWeek({ activeCount: 0, lastBornAt: null }, now), false);
});

test("成仏で研究室に妖怪がいなくなったときは、妖怪だよりで祝う", () => {
  const jobs = [{ id: "1", eventType: "ascend", yokaiId: "y1", yokaiName: "ゴミため坊", imageKey: "yokai_Y02_lv1.png" }];
  assert.match(digest.formatNotificationDigest(jobs, "unknown", true), /いま、研究室に妖怪はいません/);
  assert.doesNotMatch(digest.formatNotificationDigest(jobs, "unknown", false), /いま、研究室に妖怪はいません/);
});

test("祝う文に、人の名前や数は出さない", () => {
  for (const text of [celebration.QUIET_WEEK_MESSAGE, celebration.ALL_CLEAR_LINES.join("\n")]) {
    assert.doesNotMatch(text, /さん|くん|\d+人|\d+%/);
  }
});
