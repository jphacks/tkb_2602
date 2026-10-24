import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await test("定期報告用のDB取得", async (t) => {
  const testEnv = {
    DISCORD_TOKEN: "test-token",
    DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_GUILD_ID: "222222222222222222",
    SUPABASE_URL: "https://example.supabase.co",
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

  const guildId = testEnv.DISCORD_GUILD_ID;
  const period = {
    from: new Date("2026-10-23T18:00:00+09:00"),
    to: new Date("2026-10-24T18:00:00+09:00"),
  };
  const state = {
    id: "yokai-1", guild_id: guildId,
    location_id: "location-1", task_type_id: "task-1",
    report_count: 5, stage: "active",
    last_reported_at: "2026-10-24T08:00:00Z",
    born_at: "2026-10-23T08:00:00Z", ascended_at: null,
    location: { name: "給湯室" },
    taskType: { name: "ごみの片付け", yokai_key: "gomikui" },
  };
  const report = {
    id: "report-1", guild_id: guildId,
    location_id: state.location_id, task_type_id: state.task_type_id,
    created_at: "2026-10-24T08:00:00Z",
  };
  let db;
  let calls;
  let pageLimit;
  let failureTable;
  let nullTable;
  function reset() {
    db = {
      guild_settings: [{
        guild_id: guildId, notification_channel_id: "channel-1",
        timezone: "Asia/Tokyo", birth_threshold: 3,
      }],
      yokai_states: [structuredClone(state)],
      reports: [structuredClone(report)],
    };
    calls = [];
    pageLimit = 500;
    failureTable = null;
    nullTable = null;
  }
  reset();

  // 本物のDBには接続しない。Supabaseが送るHTTPクエリを解釈する。
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const table = url.pathname.split("/").at(-1);
    const query = url.searchParams;
    assert.equal(url.origin, testEnv.SUPABASE_URL);
    assert.equal(request.method, "GET");
    assert.equal(request.body, null);
    assert.ok(Object.hasOwn(db, table), `想定外のテーブル: ${table}`);
    const select = query.get("select");
    assert.ok(select);
    assert.doesNotMatch(select, /\*|member_key|user_id|request_id|points/);
    calls.push({ table, query });
    const respond = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (table === failureTable) {
      return respond({ code: "TEST", message: "test DB error" }, 400);
    }
    if (table === nullTable) return respond(null);

    const requestedGuild = query.get("guild_id");
    assert.ok(requestedGuild?.startsWith("eq."));
    let rows = db[table].filter((row) => `eq.${row.guild_id}` === requestedGuild);
    if (table === "yokai_states") {
      assert.equal(query.get("stage"), "in.(active,ascended)");
      assert.equal(query.get("born_at"), "not.is.null");
      rows = rows.filter((row) => ["active", "ascended"].includes(row.stage) && row.born_at);
    }
    if (table === "reports") {
      const bounds = query.getAll("created_at");
      const start = bounds.find((value) => value.startsWith("gte."))?.slice(4);
      const end = bounds.find((value) => value.startsWith("lt."))?.slice(3);
      assert.ok(start && end);
      rows = rows.filter((row) => Date.parse(row.created_at) >= Date.parse(start)
        && Date.parse(row.created_at) < Date.parse(end));
    }
    if (table !== "guild_settings") {
      assert.equal(query.get("order"), "id.asc");
      const offset = Number(query.get("offset") ?? 0);
      const limit = Math.min(Number(query.get("limit") ?? 500), pageLimit);
      rows = [...rows].sort((a, b) => a.id.localeCompare(b.id)).slice(offset, offset + limit);
    }
    return respond(rows);
  };

  const { getPeriodicReport } = await import(
    pathToFileURL(resolve("src/database/periodic-reports.ts")).href
  );

  await t.test("通知先・妖怪の現在状態・期間内の件数を返す", async () => {
    reset();
    const result = await getPeriodicReport(guildId, period);
    assert.deepEqual(result, {
      guildId, notificationChannelId: "channel-1", timezone: "Asia/Tokyo",
      periodStart: "2026-10-23T09:00:00.000Z", periodEnd: "2026-10-24T09:00:00.000Z",
      periodReportCount: 1,
      yokai: [{
        yokaiId: state.id, locationId: state.location_id, locationName: "給湯室",
        taskTypeId: state.task_type_id, taskTypeName: "ごみの片付け", yokaiKey: "gomikui",
        stage: "active", yokaiLevel: 3, reportCount: 5, periodReportCount: 1,
        lastReportedAt: state.last_reported_at, bornAt: state.born_at, ascendedAt: null,
      }],
    });
  });

  await t.test("開始時刻を含み終了時刻を含まないため、隣接する期間で二重集計しない", async () => {
    reset();
    db.reports = [
      { ...report, id: "before", created_at: "2026-10-23T08:59:59.999Z" },
      { ...report, id: "start", created_at: period.from.toISOString() },
      { ...report, id: "inside", created_at: "2026-10-24T08:59:59.999Z" },
      { ...report, id: "end", created_at: period.to.toISOString() },
    ];
    const result = await getPeriodicReport(guildId, period);
    assert.equal(result.periodReportCount, 2);
    assert.equal(result.yokai[0].periodReportCount, 2);
  });

  await t.test("気配・影・他サーバーの妖怪は公開一覧に出さず、成仏済みは含める", async () => {
    reset();
    db.yokai_states.push(
      { ...state, id: "presence", stage: "presence", born_at: null },
      { ...state, id: "shadow", stage: "shadow", born_at: null },
      { ...state, id: "unborn", born_at: null },
      { ...state, id: "other-guild", guild_id: "other" },
      { ...state, id: "ascended", stage: "ascended", location_id: "location-2",
        ascended_at: "2026-10-24T07:00:00Z" },
    );
    db.reports.push(
      { ...report, id: "unborn-report", location_id: "unborn-location" },
      { ...report, id: "other-guild-report", guild_id: "other" },
    );
    const result = await getPeriodicReport(guildId, period);
    assert.deepEqual(result.yokai.map((row) => row.yokaiId), ["ascended", "yokai-1"]);
    assert.equal(result.yokai[0].periodReportCount, 0);
    assert.equal(result.periodReportCount, 2);
    assert.doesNotMatch(JSON.stringify(result), /memberKey|userId|requestId|points/);
  });

  await t.test("報告も妖怪も0件なら空の集計を返す", async () => {
    reset();
    db.yokai_states = [];
    db.reports = [];
    db.guild_settings[0].notification_channel_id = null;
    const result = await getPeriodicReport(guildId, period);
    assert.equal(result.notificationChannelId, null);
    assert.equal(result.periodReportCount, 0);
    assert.deepEqual(result.yokai, []);
  });

  await t.test("1,000件超の報告を集計し、API上限が要求件数より小さくても全件取得する", async () => {
    reset();
    db.reports = Array.from({ length: 1201 }, (_, i) => ({
      ...report, id: `report-${String(i).padStart(4, "0")}`,
    }));
    let result = await getPeriodicReport(guildId, period);
    assert.equal(result.periodReportCount, 1201);
    assert.equal(result.yokai[0].periodReportCount, 1201);
    assert.deepEqual(calls.filter((call) => call.table === "reports")
      .map((call) => Number(call.query.get("offset"))), [0, 500, 1000, 1201]);

    reset();
    pageLimit = 2;
    db.yokai_states = Array.from({ length: 5 }, (_, i) => ({ ...state, id: `yokai-${i}` }));
    db.reports = Array.from({ length: 5 }, (_, i) => ({ ...report, id: `report-${i}` }));
    result = await getPeriodicReport(guildId, period);
    assert.equal(result.periodReportCount, 5);
    assert.equal(result.yokai.length, 5);
  });

  await t.test("不正な期間やサーバーIDはDBへ送る前に拒否する", async () => {
    reset();
    await assert.rejects(getPeriodicReport(" ", period), /サーバーID/);
    await assert.rejects(getPeriodicReport(guildId, { from: new Date("invalid") }), /有効なDate/);
    await assert.rejects(getPeriodicReport(guildId, { from: period.to, to: period.from }), /終了日時より前/);
    await assert.rejects(getPeriodicReport(guildId, { from: period.to, to: period.to }), /終了日時より前/);
    assert.equal(calls.length, 0);
  });

  await t.test("終了日時を省略した場合は現在日時まで集計する", async () => {
    reset();
    const before = Date.now();
    const result = await getPeriodicReport(guildId, { from: new Date(0) });
    assert.ok(Date.parse(result.periodEnd) >= before);
    assert.ok(Date.parse(result.periodEnd) <= Date.now());
  });

  await t.test("設定が未登録・不正、または関連データが欠ける場合は失敗を返す", async () => {
    reset();
    db.guild_settings = [];
    await assert.rejects(getPeriodicReport(guildId, period), /サーバー設定が登録されていません/);
    reset();
    db.guild_settings[0].birth_threshold = 0;
    await assert.rejects(getPeriodicReport(guildId, period), /報告回数の設定が不正/);
    reset();
    db.yokai_states[0].location = null;
    await assert.rejects(getPeriodicReport(guildId, period), /場所・雑務・誕生日時/);
  });

  await t.test("DB取得エラーやnull応答を0件扱いにしない", async () => {
    for (const table of ["guild_settings", "yokai_states", "reports"]) {
      reset();
      failureTable = table;
      await assert.rejects(getPeriodicReport(guildId, period), /test DB error/);
    }
    reset();
    nullTable = "reports";
    await assert.rejects(getPeriodicReport(guildId, period), /取得結果がありません/);
  });
});
