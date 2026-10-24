import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const logic = await import(pathToFileURL(resolve("src/logic/guardian.ts")).href);

test("守り神の段階は 10・30・60・100 ポイントで上がる", () => {
  const level = (points) => logic.guardianStage(points).level;
  assert.equal(level(0), 1);
  assert.equal(level(9), 1);
  assert.equal(level(10), 10);
  assert.equal(level(29), 10);
  assert.equal(level(30), 30);
  assert.equal(level(60), 60);
  assert.equal(level(100), 100);
  assert.equal(level(250), 100);
});

test("段階が上がった瞬間だけ「進化した」とみなす", () => {
  assert.equal(logic.didGuardianEvolve(9, 10), true);
  assert.equal(logic.didGuardianEvolve(10, 11), false);
  assert.equal(logic.didGuardianEvolve(29, 30), true);
  assert.equal(logic.didGuardianEvolve(99, 100), true);
  assert.equal(logic.didGuardianEvolve(100, 101), false);
});

test("次の進化までのポイントと、画像のファイル名", () => {
  assert.equal(logic.nextGuardianStage(7).min, 10);
  assert.equal(logic.nextGuardianStage(100), null);
  assert.equal(logic.guardianImageKey("C", 35), "kami_C_lv30.png");
  assert.equal(logic.guardianImageKey("A", 0), "kami_A_lv1.png");
});

test("守り神のキーは A〜E だけ", () => {
  assert.equal(logic.isGuardianKey("E"), true);
  assert.equal(logic.isGuardianKey("F"), false);
  assert.equal(logic.isGuardianKey(null), false);
});
