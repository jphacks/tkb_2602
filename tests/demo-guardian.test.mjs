import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// /demo の「守り神ポイント＋10」ボタン（データベースには実際にはつながない）
await test("/demoの守り神ポイント＋10", async (t) => {
  const testEnv = {
    DISCORD_TOKEN: "test-token", DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_GUILD_ID: "222222222222222222", SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "test-only-secret", MEMBER_KEY_SECRET: "test-member-secret",
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

  const guildId = testEnv.DISCORD_GUILD_ID;
  const userId = "444444444444444444";
  let row = null; // guardian_points の1行
  let writes = [];

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const table = url.pathname.split("/").at(-1);
    const respond = (body) => new Response(JSON.stringify(body), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    if (table === "guild_settings") return respond([{ time_offset_seconds: 0 }]);
    assert.equal(table, "guardian_points");
    if (request.method === "GET") return respond(row ? [row] : []);
    assert.equal(request.method, "POST");
    const body = await request.json();
    writes.push(body);
    row = { guardian_key: row?.guardian_key ?? null, ...body };
    return respond([]);
  };

  const { demo } = await import(pathToFileURL(resolve("src/commands/demo.ts")).href);

  function interaction(admin = true) {
    const events = [];
    return {
      events,
      guildId, customId: "demo:guardian", user: { id: userId },
      isButton: () => true,
      memberPermissions: { has: () => admin },
      reply: async (message) => events.push({ type: "reply", message }),
      deferUpdate: async () => events.push({ type: "defer" }),
      editReply: async (message) => events.push({ type: "edit", message }),
      followUp: async (message) => events.push({ type: "followUp", message }),
    };
  }

  await t.test("押すと10増えて、進化したら進化のカードを本人にだけ見せる", async () => {
    row = { guardian_key: "B", points: 3 };
    writes = [];
    const target = interaction();
    await demo.handleComponent(target);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].points, 13);
    assert.equal("guardian_key" in writes[0], false); // 選んだ守り神は書きかえない
    assert.notEqual(writes[0].member_key, userId); // Discord ID そのものは保存しない
    const card = target.events.find((event) => event.type === "followUp").message;
    assert.match(card.content, /守り神が進化しました/);
    assert.match(card.embeds[0].title, /狛犬/);
    assert.ok(card.flags); // 本人にだけ見える
    assert.match(target.events.at(-1).message.content, /3 → 13/);
  });

  await t.test("進化しないときは、増えたことだけ伝える", async () => {
    row = { guardian_key: "B", points: 13 };
    const target = interaction();
    await demo.handleComponent(target);
    const card = target.events.find((event) => event.type === "followUp").message;
    assert.match(card.content, /10 増えました/);
  });

  await t.test("守り神をまだ選んでいなければ、選ぶ画面を出す", async () => {
    row = null;
    const target = interaction();
    await demo.handleComponent(target);
    const card = target.events.find((event) => event.type === "followUp").message;
    assert.match(card.content, /守り神を選んでください/);
    assert.ok(card.components.length > 0);
  });

  await t.test("管理者でなければ増やさない", async () => {
    writes = [];
    const target = interaction(false);
    await demo.handleComponent(target);
    assert.equal(writes.length, 0);
    assert.equal(target.events[0].type, "reply");
  });
});
