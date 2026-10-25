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

const { oharaiAdvice } = await import(pathToFileURL(resolve("src/logic/oharai.ts")).href);
const digest = await import(pathToFileURL(resolve("src/notifications/digest.ts")).href);

test("お祓いの作法は、やり残されていたことの名前から選ぶ", () => {
  assert.match(oharaiAdvice("洗い物が残っていた"), /洗う/);
  assert.match(oharaiAdvice("器具の洗浄"), /洗う/);
  assert.match(oharaiAdvice("ゴミがあふれていた"), /ゴミの日/);
  assert.match(oharaiAdvice("電気の消し忘れ"), /消灯/);
  assert.match(oharaiAdvice("備品が切れていた"), /補充/);
  assert.match(oharaiAdvice("プリンターのトナー切れ"), /補充/);
  assert.match(oharaiAdvice("排水溝の掃除"), /掃除/);
  assert.match(oharaiAdvice("出しっぱなし"), /元の場所/);
});

test("当てはまらない名前や、名前がないときは、共通の作法を出す", () => {
  assert.match(oharaiAdvice("謎の困りごと"), /研究室で決めて/);
  assert.match(oharaiAdvice(null), /研究室で決めて/);
});

test("お祓いの作法は、誰かを責める言い方をしない", () => {
  const names = ["洗い物", "ゴミ", "冷蔵庫", "電気", "エアコン", "備品", "紙詰まり", "掃除", "返却", "机", "出しっぱなし", "その他"];
  for (const name of names) {
    assert.doesNotMatch(oharaiAdvice(name), /犯人|だれか|誰か|せい[でだ]|ちゃんと|いい加減/, name);
  }
});

test("妖怪だよりで、生まれた妖怪にだけお祓いの作法を添える", () => {
  const text = digest.formatNotificationDigest([
    { id: "1", eventType: "birth", yokaiId: "y1", yokaiName: "ゴミため坊", imageKey: "yokai_Y02_lv1.png", taskName: "ゴミがあふれていた" },
    { id: "2", eventType: "ascend", yokaiId: "y2", yokaiName: "あらいわすれ坊", imageKey: "yokai_Y01_lv1.png", taskName: "洗い物" },
  ]);
  assert.match(text, /\*\*ゴミため坊\*\*\n    - お祓いの作法：.*ゴミの日/);
  assert.equal((text.match(/お祓いの作法/g) ?? []).length, 1);
});

test("成仏があった妖怪だよりでは、効いた工夫の共有を一度だけ呼びかける", () => {
  const withAscend = digest.formatNotificationDigest([
    { id: "1", eventType: "ascend", yokaiId: "y1", yokaiName: "ゴミため坊", imageKey: "yokai_Y02_lv1.png", taskName: "ゴミ" },
    { id: "2", eventType: "ascend", yokaiId: "y2", yokaiName: "あらいわすれ坊", imageKey: "yokai_Y01_lv1.png", taskName: "洗い物" },
  ]);
  assert.equal((withAscend.match(/効いた工夫/g) ?? []).length, 1);
  const withoutAscend = digest.formatNotificationDigest([
    { id: "3", eventType: "presence", yokaiId: null, yokaiName: null, imageKey: null },
  ]);
  assert.doesNotMatch(withoutAscend, /効いた工夫/);
});

test("弱ってきた妖怪は、名前と「もうすぐ成仏しそう」を出す", () => {
  const text = digest.formatNotificationDigest([
    { id: "1", eventType: "weaken", yokaiId: "y1", yokaiName: "ゴミため坊", imageKey: "yokai_Y02_lv1.png", taskName: "ゴミ" },
  ]);
  assert.match(text, /弱ってきた：1件/);
  assert.match(text, /\*\*ゴミため坊\*\*/);
  assert.match(text, /もうすぐ成仏しそう/);
  // 弱ってきた知らせだけなら、成仏の呼びかけは出さない
  assert.doesNotMatch(text, /効いた工夫/);
});
