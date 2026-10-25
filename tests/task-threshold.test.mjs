import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const logic = await import(pathToFileURL(resolve("src/logic/task-threshold.ts")).href);

test("「名前=回数」を、名前と出現回数に分ける", () => {
  assert.deepEqual(logic.splitTaskLine("器具の洗浄=1"), { name: "器具の洗浄", threshold: 1 });
  assert.deepEqual(logic.splitTaskLine("器具の洗浄 = 2"), { name: "器具の洗浄", threshold: 2 });
  // 全角の「＝」と数字も受け付ける
  assert.deepEqual(logic.splitTaskLine("トナー切れ＝１"), { name: "トナー切れ", threshold: 1 });
});

test("回数を書かなければ、全体の値を使う（null）", () => {
  assert.deepEqual(logic.splitTaskLine("洗い物が残っていた"), { name: "洗い物が残っていた", threshold: null });
});

test("回数は1〜10だけ", () => {
  assert.match(logic.splitTaskLine("器具の洗浄=0").error, /1〜10/);
  assert.match(logic.splitTaskLine("器具の洗浄=11").error, /1〜10/);
});

test("設定画面には「名前=回数」で出す（決めていなければ名前だけ）", () => {
  assert.equal(logic.formatTaskLine("器具の洗浄", 1), "器具の洗浄=1");
  assert.equal(logic.formatTaskLine("洗い物が残っていた", undefined), "洗い物が残っていた");
});
