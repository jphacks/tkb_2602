import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await test("/demoの通知と確認画面", async (t) => {
  const testEnv = {
    DISCORD_TOKEN: "test-token", DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_GUILD_ID: "222222222222222222", SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "test-only-secret",
  };
  const previousEnv = new Map(Object.keys(testEnv).map((key) => [key, process.env[key]]));
  Object.assign(process.env, testEnv);
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const guildId = testEnv.DISCORD_GUILD_ID;
  const channelId = "333333333333333333";
  const jobs = Array.from({ length: 11 }, (_, i) => ({
    id: `job-${i}`, event_type: "birth", yokai_id: `yokai-${i}`,
  }));
  const identities = jobs.map((job) => ({
    id: job.yokai_id, yokai_name: "あらいわすれ坊", image_key: "yokai_Y01_lv1.png",
  }));
  let events = [];
  let dbCalls = [];
  let sendFailure = false;
  console.error = () => {};
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, testEnv.SUPABASE_URL);
    const table = url.pathname.split("/").at(-1);
    dbCalls.push({ table, method: request.method });
    const respond = (body) => new Response(JSON.stringify(body), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    if (table === "guild_settings") {
      assert.equal(request.method, "GET");
      assert.equal(url.searchParams.get("guild_id"), `eq.${guildId}`);
      if (url.searchParams.get("select") === "time_offset_seconds") {
        return respond([{ time_offset_seconds: 4 * 86400 }]);
      }
      return respond([{
        notification_channel_id: channelId, admin_channel_id: null,
        notification_time: "18:00:00", birth_threshold: 3,
      }]);
    }
    if (table === "process_yokai_ascensions") {
      const args = await request.json();
      assert.equal(args.p_guild_id, guildId);
      assert.ok(Math.abs(Date.parse(args.p_now) - Date.now() - 4 * 86400000) < 5000);
      return respond(0);
    }
    if (table === "yokai_states") return respond(identities);
    assert.equal(table, "notification_jobs");
    if (request.method === "GET") {
      return respond(Number(url.searchParams.get("offset") ?? 0) === 0 ? jobs : []);
    }
    assert.equal(request.method, "PATCH");
    events.push({ type: "mark", body: await request.json() });
    return respond([]);
  };
  const { demo } = await import(pathToFileURL(resolve("src/commands/demo.ts")).href);
  const { PermissionFlagsBits } = await import("discord.js");

  function interaction(action, admin = true) {
    return {
      guildId, customId: `demo:${action}`,
      isButton: () => true,
      memberPermissions: { has: (permission) => {
        assert.equal(permission, PermissionFlagsBits.ManageGuild);
        return admin;
      } },
      client: { channels: { fetch: async (id) => {
        assert.equal(id, channelId);
        return {
          id, isSendable: () => true,
          send: async (message) => {
            assert.equal(typeof message.content, "string");
            assert.ok(Array.isArray(message.embeds));
            assert.ok(message.files.length > 0);
            if (sendFailure && events.some((event) => event.type === "send")) throw new Error("send failed");
            events.push({ type: "send", message });
          },
        };
      } } },
      reply: async (message) => { events.push({ type: "reply", message }); },
      deferUpdate: async () => { events.push({ type: "defer" }); },
      editReply: async (message) => { events.push({ type: "edit", message }); },
      followUp: async (message) => { events.push({ type: "followUp", message }); },
    };
  }

  await t.test("即時通知は画像付きの複数メッセージを送信してから送信済みにする", async () => {
    events = [];
    dbCalls = [];
    await demo.handleComponent(interaction("summary"));
    const sent = events.filter((event) => event.type === "send");
    assert.deepEqual(sent.map((event) => event.message.embeds.length), [10, 1]);
    assert.deepEqual(events.map((event) => event.type), ["defer", "send", "send", "mark", "edit"]);
    assert.match(events.at(-1).message.content, /まとめ通知を送りました（11件）/);
  });

  await t.test("複数メッセージの送信途中に失敗した場合は送信済みにしない", async () => {
    events = [];
    sendFailure = true;
    try {
      await demo.handleComponent(interaction("summary"));
      assert.equal(events.some((event) => event.type === "mark"), false);
      assert.equal(events.at(-1).type, "followUp");
      assert.match(events.at(-1).message.content, /操作できませんでした/);
    } finally {
      sendFailure = false;
    }
  });

  await t.test("リセットボタンは確認画面を表示するだけで、DBを削除しない", async () => {
    events = [];
    dbCalls = [];
    await demo.handleComponent(interaction("reset"));
    assert.equal(dbCalls.length, 0);
    assert.match(events.at(-1).message.content, /リセットしますか/);
    assert.equal(events.at(-1).message.components.length, 1);
  });

  await t.test("管理者権限がない場合はデモ操作を実行しない", async () => {
    events = [];
    dbCalls = [];
    await demo.handleComponent(interaction("summary", false));
    assert.equal(dbCalls.length, 0);
    assert.equal(events[0].type, "reply");
    assert.match(events[0].message.content, /サーバー管理の権限/);
  });
});
