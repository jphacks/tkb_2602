import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const reply = await import(pathToFileURL(resolve("src/notifications/report-reply.ts")).href);
const guardian = await import(pathToFileURL(resolve("src/logic/guardian.ts")).href);
const catalog = await import(pathToFileURL(resolve("src/notifications/yokai-catalog.ts")).href);

const context = { locationName: "流し", taskTypeName: "洗い物" };
const base = { duplicate: false, reportCount: 1, yokaiId: "y1", yokaiLevel: 0, points: 18, pointsAwarded: true };

test("守り神のバー：次の姿までの進み具合を10マスで出す", () => {
  assert.equal(guardian.guardianProgressBar(0), "▱▱▱▱▱▱▱▱▱▱ 0 / 10　次の姿まであと10");
  assert.equal(guardian.guardianProgressBar(18), "▰▰▰▰▱▱▱▱▱▱ 18 / 30　次の姿まであと12");
  assert.equal(guardian.guardianProgressBar(30), "▱▱▱▱▱▱▱▱▱▱ 30 / 60　次の姿まであと30");
  assert.equal(guardian.guardianProgressBar(99), "▰▰▰▰▰▰▰▰▰▱ 99 / 100　次の姿まであと1");
  assert.equal(guardian.guardianProgressBar(120), "▰▰▰▰▰▰▰▰▰▰ 120　最後の姿です");
});

test("気配・影・レベルアップの返事は、段階ごとの色のカードになる", () => {
  const presence = reply.reportReply({ ...base, stage: "presence" }, context);
  const shadow = reply.reportReply({ ...base, stage: "shadow" }, context);
  const levelUp = reply.reportReply({ ...base, stage: "active", yokaiLevel: 3 }, context);
  assert.equal(presence.embeds[0].color, reply.STAGE_COLORS.presence);
  assert.equal(shadow.embeds[0].color, reply.STAGE_COLORS.shadow);
  assert.equal(levelUp.embeds[0].color, reply.STAGE_COLORS.active);
  assert.match(presence.embeds[0].description, /流しの「洗い物」/);
  assert.match(levelUp.embeds[0].title, /Lv\.3/);
  assert.match(presence.content, /18 \/ 30/);
});

test("同じ記録の2回目は、カードにしない", () => {
  const dup = reply.reportReply({ ...base, duplicate: true, stage: "presence" }, context);
  assert.equal(dup.embeds, undefined);
});

test("ポイントが増えなかったときは、1時間に1回の説明を出す", () => {
  const r = reply.reportReply({ ...base, stage: "presence", pointsAwarded: false }, context);
  assert.match(r.content, /1時間に1回/);
});

test("誕生のカードに、妖怪の紹介文が入る", () => {
  const frames = reply.birthFrames(
    { ...base, stage: "active", yokaiLevel: 1 },
    context,
    { yokaiName: "あらいわすれ坊", imageKey: "yokai_Y01_lv1.png" },
  );
  assert.equal(frames.length, 3);
  assert.equal(frames[0].embeds[0].color, reply.STAGE_COLORS.presence);
  assert.equal(frames[1].embeds[0].color, reply.STAGE_COLORS.shadow);
  const last = frames[2].embeds[0];
  assert.match(last.title, /あらいわすれ坊 が姿を現した/);
  assert.ok(last.description.includes(catalog.YOKAI_INTROS.Y01));
});

test("AIで作った妖怪など、紹介文がない妖怪でも誕生のカードは出る", () => {
  const frames = reply.birthFrames(
    { ...base, stage: "active", yokaiLevel: 1 },
    context,
    { yokaiName: "かみため坊", imageKey: "custom_00000000-0000-0000-0000-000000000000.png" },
  );
  assert.match(frames[2].embeds[0].description, /^流しの「洗い物」に住みついた妖怪です。（Lv\.1）\n\n\*\*お祓いの作法\*\*/);
});

test("紹介文は10体ぶんそろっていて、報告者を責める言葉を使わない", () => {
  assert.deepEqual(Object.keys(catalog.YOKAI_INTROS), Object.keys(catalog.YOKAI_NAMES));
  for (const text of Object.values(catalog.YOKAI_INTROS)) {
    assert.doesNotMatch(text, /犯人|だれか|誰か|せい[でだ]/);
  }
});
