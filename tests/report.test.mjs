import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await test("report関連の単体テスト", async (t) => {
  // 本物の秘密鍵を使わない
  const testEnv = {
    DISCORD_TOKEN: "test-token",
    DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_GUILD_ID: "222222222222222222",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "test-only-secret",
    MEMBER_KEY_SECRET: "test-only-member-secret",
  };

  const previousEnv = new Map(
    Object.keys(testEnv).map((key) => [key, process.env[key]]),
  );

  Object.assign(process.env, testEnv);

  const originalFetch = globalThis.fetch;
  const rpcCalls = [];

  const success = {
    duplicate: false,
    points: 3,
    yokaiId: "40000000-0000-4000-8000-000000000001",
    reportCount: 3,
    stage: "active",
    yokaiLevel: 1,
  };

  let responseBody = success;
  let responseStatus = 200;

  // HTTP通信をダミーにする。外部には接続しない
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);

    assert.equal(
      request.url,
      `${testEnv.SUPABASE_URL}/rest/v1/rpc/submit_report`,
    );
    assert.equal(request.method, "POST");

    rpcCalls.push(await request.json());

    return new Response(JSON.stringify(responseBody), {
      status: responseStatus,
      headers: { "Content-Type": "application/json" },
    });
  };

  // テスト終了後に元へ戻す
  t.after(() => {
    globalThis.fetch = originalFetch;

    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  // テスト用の設定・通信に切り替えてから読み込む
  const { createReportSession } = await import(
    pathToFileURL(resolve("src/database/report-session.ts")).href
  );

  const { submitReport } = await import(
    pathToFileURL(resolve("src/database/reports.ts")).href
  );

  const guildId = testEnv.DISCORD_GUILD_ID;
  const userId = "333333333333333333";
  const session = createReportSession(guildId, userId);

  const input = {
    requestId: session.requestId,
    guildId: session.guildId,
    memberKey: session.memberKey,
    locationId: "10000000-0000-4000-8000-000000000001",
    taskTypeId: "20000000-0000-4000-8000-000000000001",
  };

  await t.test("報告ごとに別のUUID、同じ本人には同じキー", () => {
    const another = createReportSession(guildId, userId);

    assert.match(
      session.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    assert.notEqual(session.requestId, another.requestId);
    assert.equal(session.memberKey, another.memberKey);
    assert.match(session.memberKey, /^[0-9a-f]{64}$/);
    assert.equal(session.guildId, guildId);
    assert.equal(session.userId, userId);
    assert.equal(rpcCalls.length, 0);
  });

  await t.test("ユーザーやサーバーが違えば本人用キーも違う", () => {
    const otherUser = createReportSession(
      guildId,
      "444444444444444444",
    );

    const otherGuild = createReportSession(
      "555555555555555555",
      userId,
    );

    assert.notEqual(session.memberKey, otherUser.memberKey);
    assert.notEqual(session.memberKey, otherGuild.memberKey);
  });

  await t.test("秘密文字列が未設定ならエラー", () => {
    delete process.env.MEMBER_KEY_SECRET;

    try {
      assert.throws(
        () => createReportSession(guildId, userId),
        /MEMBER_KEY_SECRETが未設定/,
      );
    } finally {
      process.env.MEMBER_KEY_SECRET = testEnv.MEMBER_KEY_SECRET;
    }
  });

  await t.test("RPCへ正しい項目を渡し、結果を返す", async () => {
    const result = await submitReport(input);

    assert.deepEqual(result, success);

    assert.deepEqual(rpcCalls.at(-1), {
      p_request_id: input.requestId,
      p_guild_id: input.guildId,
      p_location_id: input.locationId,
      p_task_type_id: input.taskTypeId,
      p_member_key: input.memberKey,
    });
  });

  await t.test("同じIDで再送し、duplicateを受け取れる", async () => {
    responseBody = { ...success, duplicate: true };

    const result = await submitReport(input);

    assert.equal(result.duplicate, true);
    assert.equal(result.points, 3);
    assert.equal(
      rpcCalls.at(-1).p_request_id,
      rpcCalls.at(-2).p_request_id,
    );
  });

  await t.test("いつもの仕事の結果は妖怪なしで受け取れる", async () => {
    responseBody = {
      ...success, taskKind: "routine", yokaiId: null, stage: null,
      reportCount: 0, yokaiLevel: 0, pointsAwarded: true, guardianKey: "B",
    };
    const result = await submitReport(input);
    assert.deepEqual(result, responseBody);
    assert.equal(rpcCalls.at(-1).p_task_type_id, input.taskTypeId);
  });

  await t.test("DBエラーを呼び出し元へ返す", async () => {
    responseStatus = 400;
    responseBody = {
      code: "22023",
      message: "test-error",
      details: null,
      hint: null,
    };

    await assert.rejects(
      () => submitReport(input),
      /報告の保存に失敗しました: test-error/,
    );
  });

  await t.test("結果がnullならエラー", async () => {
    responseStatus = 200;
    responseBody = null;

    await assert.rejects(
      () => submitReport(input),
      /報告結果を取得できませんでした/,
    );
  });
});
