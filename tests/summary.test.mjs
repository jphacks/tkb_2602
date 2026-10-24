import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await test("/summaryの手動通知", async (t) => {
  const testEnv = {
    DISCORD_TOKEN: "test-token",
    DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_GUILD_ID: "222222222222222222",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "test-only-secret",
  };
  const previousEnv = new Map(
    Object.keys(testEnv).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, testEnv);

  const originalFetch = globalThis.fetch;
  let jobs = [];
  let identities = [];
  let updates = [];
  let calls = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const table = url.pathname.split("/").at(-1);
    const respond = (body) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    // getNow() が読む「時間のずれ」。順番の確認には含めない
    if (table === "guild_settings" && request.method === "GET") {
      assert.match(url.searchParams.get("select"), /time_offset_seconds/);
      return respond([{ time_offset_seconds: 0 }]);
    }
    calls.push({ table, method: request.method, body: request.method === "POST" ? await request.clone().json() : null });
    if (table === "process_yokai_ascensions") {
      assert.equal(request.method, "POST");
      return respond(1);
    }
    if (table === "yokai_states") {
      assert.equal(request.method, "GET");
      assert.match(url.searchParams.get("id"), /^in\.\(/);
      return respond(identities);
    }
    assert.equal(table, "notification_jobs");
    if (request.method === "GET") {
      assert.equal(url.searchParams.get("guild_id"), `eq.${testEnv.DISCORD_GUILD_ID}`);
      assert.equal(url.searchParams.get("sent_at"), "is.null");
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return respond(offset === 0 ? jobs : []);
    }
    if (request.method === "PATCH") {
      updates.push(await request.json());
      return respond([]);
    }
    assert.fail(`想定外のリクエスト: ${request.method} ${url.pathname}`);
  };

  const { summary } = await import(
    pathToFileURL(resolve("src/commands/summary.ts")).href
  );

  function interaction(guildId = testEnv.DISCORD_GUILD_ID) {
    const calls = [];
    return {
      guildId,
      calls,
      deferReply: async (...args) => calls.push({ method: "deferReply", args }),
      editReply: async (...args) => calls.push({ method: "editReply", args }),
      reply: async (...args) => calls.push({ method: "reply", args }),
    };
  }

  await t.test("未報告データを公開応答し、送信後にsent_atを保存する", async () => {
    jobs = [
      { id: "job-1", event_type: "presence", yokai_id: null },
      { id: "job-2", event_type: "birth", yokai_id: "yokai-1" },
      { id: "job-3", event_type: "ascend", yokai_id: "yokai-2" },
    ];
    identities = [
      { id: "yokai-1", yokai_name: "洗い物の妖怪", image_key: "yokai_Y01_lv1.png" },
      { id: "yokai-2", yokai_name: "ゴミ出しの妖怪", image_key: "yokai_Y02_lv5.png" },
    ];
    updates = [];
    calls = [];
    const target = interaction();
    await summary.execute(target);

    assert.deepEqual(target.calls[0], { method: "deferReply", args: [] });
    assert.match(target.calls[1].args[0].content, /未報告だった変化は \*\*3件\*\*/);
    assert.match(target.calls[1].args[0].content, /\*\*あらいわすれ坊\*\*/);
    assert.match(target.calls[1].args[0].content, /\*\*ゴミため坊\*\*/);
    assert.deepEqual(
      target.calls[1].args[0].embeds.map((embed) => embed.title),
      ["妖怪誕生：あらいわすれ坊", "成仏：ゴミため坊"],
    );
    assert.equal(target.calls[1].args[0].files.length, 2);
    assert.match(target.calls[1].args[0].files[0].attachment, /yokai_Y01_lv1\.png$/);
    assert.equal(updates.length, 1);
    assert.match(updates[0].sent_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(calls[0].table, "process_yokai_ascensions");
    assert.deepEqual(calls[0].body.p_guild_id, testEnv.DISCORD_GUILD_ID);
    assert.equal(calls[1].table, "notification_jobs");
  });

  await t.test("未報告データがない場合も公開で結果を知らせる", async () => {
    jobs = [];
    identities = [];
    updates = [];
    calls = [];
    const target = interaction();
    await summary.execute(target);

    assert.deepEqual(target.calls[0], { method: "deferReply", args: [] });
    assert.deepEqual(target.calls[1], {
      method: "editReply",
      args: ["未報告の妖怪の変化はありません。"],
    });
    assert.equal(updates.length, 0);
    assert.equal(calls[0].table, "process_yokai_ascensions");
  });

  await t.test("サーバー外では実行しない", async () => {
    const target = interaction(null);
    await summary.execute(target);
    assert.deepEqual(target.calls, [{
      method: "reply",
      args: ["このコマンドはサーバーの中で使ってください。"],
    }]);
  });

  await t.test("コマンド名はsummaryでGuild限定", () => {
    const json = summary.data.toJSON();
    assert.equal(json.name, "summary");
    assert.deepEqual(json.contexts, [0]);
  });
});
