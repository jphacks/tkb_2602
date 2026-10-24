import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await test("notification_jobsの定時通知", async (t) => {
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
  const originalConsoleError = console.error;
  const notifyId = "333333333333333333";
  let schedules;
  let jobs;
  let reads;
  let updates;
  let messages;
  let sendFailure;

  function reset() {
    schedules = [{
      guild_id: testEnv.DISCORD_GUILD_ID,
      notification_channel_id: notifyId,
      notification_time: "18:00:00",
      timezone: "Asia/Tokyo",
    }];
    jobs = [
      { id: "job-1", event_type: "presence", yokai_id: null },
      { id: "job-2", event_type: "presence", yokai_id: null },
      { id: "job-3", event_type: "shadow", yokai_id: null },
      { id: "job-4", event_type: "birth", yokai_id: "yokai-1" },
      { id: "job-5", event_type: "level_up", yokai_id: "yokai-1" },
    ];
    reads = [];
    updates = [];
    messages = [];
    sendFailure = false;
  }
  reset();

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const table = url.pathname.split("/").at(-1);
    const respond = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
    reads.push({ table, method: request.method, query: url.searchParams });

    if (table === "guild_settings") {
      assert.equal(request.method, "GET");
      assert.match(url.searchParams.get("select"), /notification_time/);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return respond(offset === 0 ? schedules : []);
    }
    if (table === "process_yokai_ascensions") {
      assert.equal(request.method, "POST");
      const body = await request.json();
      assert.equal(body.p_guild_id, schedules[0].guild_id);
      assert.match(body.p_now, /^\d{4}-\d{2}-\d{2}T/);
      return respond(1);
    }
    if (table === "notification_jobs" && request.method === "GET") {
      assert.equal(url.searchParams.get("guild_id"), `eq.${schedules[0].guild_id}`);
      assert.equal(url.searchParams.get("sent_at"), "is.null");
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return respond(offset === 0 ? jobs : []);
    }
    if (table === "yokai_states" && request.method === "GET") {
      assert.match(url.searchParams.get("id"), /^in\.\(/);
      return respond([{
        id: "yokai-1",
        yokai_name: "洗い物の妖怪",
        image_key: "yokai_Y01_lv1.png",
      }]);
    }
    if (table === "notification_jobs" && request.method === "PATCH") {
      assert.equal(url.searchParams.get("sent_at"), "is.null");
      assert.match(url.searchParams.get("id"), /^in\.\(/);
      updates.push(await request.json());
      return respond([]);
    }
    assert.fail(`想定外のリクエスト: ${request.method} ${url.pathname}`);
  };

  const client = {
    channels: {
      fetch: async (channelId) => {
        assert.equal(channelId, notifyId);
        return {
          isSendable: () => true,
          send: async (message) => {
            if (sendFailure) throw new Error("Discord test error");
            messages.push(message);
          },
        };
      },
    },
  };
  console.error = () => {};

  const { formatNotificationDigest, runScheduledNotifications } = await import(
    pathToFileURL(resolve("src/notifications/digest.ts")).href
  );

  await t.test("指定時刻に未送信行を集計し、送信成功後にsent_atを保存する", async () => {
    reset();
    const now = new Date("2026-10-24T09:00:00.000Z");
    await runScheduledNotifications(client, async () => now);

    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /未報告だった変化は \*\*5件\*\*/);
    assert.match(messages[0].content, /気配：2件/);
    assert.match(messages[0].content, /影：1件/);
    assert.match(messages[0].content, /妖怪誕生：1件/);
    assert.match(messages[0].content, /\*\*あらいわすれ坊\*\*/);
    assert.match(messages[0].content, /レベルアップ：1件/);
    assert.equal(messages[0].embeds[0].title, "妖怪誕生：あらいわすれ坊");
    assert.match(messages[0].files[0].attachment, /yokai_Y01_lv1\.png$/);
    assert.deepEqual(updates, [{ sent_at: now.toISOString() }]);
    const ascensionIndex = reads.findIndex((call) => call.table === "process_yokai_ascensions");
    const jobsIndex = reads.findIndex((call) => call.table === "notification_jobs");
    assert.ok(ascensionIndex >= 0 && ascensionIndex < jobsIndex);
  });

  await t.test("同じGuild・同じ時刻枠は二重実行しない", async () => {
    const previousReads = reads.length;
    const previousMessages = messages.length;
    await runScheduledNotifications(
      client,
      async () => new Date("2026-10-24T09:00:30.000Z"),
    );
    assert.equal(messages.length, previousMessages);
    assert.equal(reads.length, previousReads + 2); // 設定一覧のページ取得だけ
  });

  await t.test("指定時刻外はnotification_jobsを読まない", async () => {
    reset();
    await runScheduledNotifications(
      client,
      async () => new Date("2026-10-25T08:59:00.000Z"),
    );
    assert.equal(messages.length, 0);
    assert.equal(reads.filter((call) => call.table === "notification_jobs").length, 0);
  });

  await t.test("Discord送信失敗時はsent_atを保存せず、同じ枠で再試行できる", async () => {
    reset();
    schedules[0].guild_id = "retry-guild";
    sendFailure = true;
    const now = new Date("2026-10-25T09:00:00.000Z");
    await runScheduledNotifications(client, async () => now);
    assert.equal(updates.length, 0);

    sendFailure = false;
    await runScheduledNotifications(client, async () => now);
    assert.equal(messages.length, 1);
    assert.equal(updates.length, 1);
  });

  await t.test("通知文は未知のevent_typeも件数表示する", () => {
    assert.match(
      formatNotificationDigest([{ id: "x", eventType: "future_event" }]),
      /future_event：1件/,
    );
  });
});
