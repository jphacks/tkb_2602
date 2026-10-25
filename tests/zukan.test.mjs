import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await test("/zukan 妖怪図鑑", async (t) => {
  const testEnv = {
    DISCORD_TOKEN: "test-token", DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_GUILD_ID: "222222222222222222", SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "test-only-secret",
  };
  const previousEnv = new Map(Object.keys(testEnv).map((key) => [key, process.env[key]]));
  Object.assign(process.env, testEnv);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let states = [];
  let pendingBirths = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(new Request(input, init).url);
    const table = url.pathname.split("/").at(-1);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const respond = (body) => new Response(JSON.stringify(offset === 0 ? body : []), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    if (table === "notification_jobs") return respond(pendingBirths);
    assert.equal(table, "yokai_states");
    assert.equal(url.searchParams.get("stage"), "in.(active,ascended)");
    return respond(states);
  };

  const { zukan, formatZukan } = await import(pathToFileURL(resolve("src/commands/zukan.ts")).href);
  const row = (id, stage, name, imageKey, place, task) => ({
    id, stage, yokai_name: name, image_key: imageKey, location: { name: place }, taskType: { name: task },
  });
  function interaction() {
    const calls = [];
    return {
      guildId: testEnv.DISCORD_GUILD_ID, calls,
      deferReply: async (...args) => calls.push({ method: "deferReply", args }),
      editReply: async (...args) => calls.push({ method: "editReply", args }),
      followUp: async (...args) => calls.push({ method: "followUp", args }),
      reply: async (...args) => calls.push({ method: "reply", args }),
    };
  }

  await t.test("今いる妖怪と成仏した妖怪を分けて、お祓いの作法つきで本人にだけ見せる", async () => {
    states = [
      row("y1", "active", "ゴミの妖怪", "yokai_Y02_lv1.png", "机", "ゴミ出し"),
      row("y2", "ascended", "洗い物の妖怪", "yokai_Y01_lv1.png", "流し", "洗い物"),
    ];
    pendingBirths = [];
    const target = interaction();
    await zukan.execute(target);
    assert.ok(target.calls[0].args[0].flags, "本人にだけ見える");
    const text = target.calls[1].args[0];
    assert.match(text, /出会った妖怪：\*\*2体\*\*（いまいる 1体・成仏 1体）/);
    assert.match(text, /いまいる妖怪[\s\S]*ゴミため坊[\s\S]*ゴミの日/);
    assert.match(text, /成仏した妖怪[\s\S]*あらいわすれ坊[\s\S]*洗う/);
  });

  await t.test("誕生がまだ妖怪だよりで知らされていない妖怪は出さない", async () => {
    states = [row("y3", "active", "ゴミの妖怪", "yokai_Y02_lv1.png", "机", "ゴミ出し")];
    pendingBirths = [{ id: "job", yokai_id: "y3" }];
    const target = interaction();
    await zukan.execute(target);
    assert.match(target.calls[1].args[0], /まだ妖怪に出会っていません/);
    pendingBirths = [];
  });

  await t.test("長い図鑑は、Discord の1通の長さで分ける", () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      id: `id-${i}`, yokaiName: `妖怪${i}`, locationName: "実験台", taskTypeName: "器具の洗浄", ascended: i % 2 === 0,
    }));
    const messages = formatZukan(entries);
    assert.ok(messages.length > 1);
    for (const message of messages) assert.ok(message.length <= 2000);
  });

  await t.test("コマンド名は zukan でサーバー限定", () => {
    const json = zukan.data.toJSON();
    assert.equal(json.name, "zukan");
    assert.deepEqual(json.contexts, [0]);
  });
});
