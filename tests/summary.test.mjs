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
  let updates = [];

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
      { id: "job-1", event_type: "presence" },
      { id: "job-2", event_type: "shadow" },
    ];
    updates = [];
    const target = interaction();
    await summary.execute(target);

    assert.deepEqual(target.calls[0], { method: "deferReply", args: [] });
    assert.match(target.calls[1].args[0].content, /未報告だった変化は \*\*2件\*\*/);
    assert.equal(updates.length, 1);
    assert.match(updates[0].sent_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  await t.test("未報告データがない場合も公開で結果を知らせる", async () => {
    jobs = [];
    updates = [];
    const target = interaction();
    await summary.execute(target);

    assert.deepEqual(target.calls[0], { method: "deferReply", args: [] });
    assert.deepEqual(target.calls[1], {
      method: "editReply",
      args: ["未報告の妖怪の変化はありません。"],
    });
    assert.equal(updates.length, 0);
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
