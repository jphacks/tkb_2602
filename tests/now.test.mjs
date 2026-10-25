import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await test("/nowの現在妖怪一覧", async (t) => {
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
  let states = [];
  let pendingBirths = [];
  let taskThresholds = [];
  const requests = [];

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
    requests.push({ table, method: request.method, query: url.searchParams });
    const respond = (body) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    assert.equal(request.method, "GET");
    if (table === "guild_settings") return respond({ birth_threshold: 3 });
    if (table === "task_types") {
      assert.equal(url.searchParams.get("select"), "id,birth_threshold");
      return respond(taskThresholds);
    }
    if (table === "notification_jobs") {
      assert.equal(url.searchParams.get("event_type"), "eq.birth");
      assert.equal(url.searchParams.get("sent_at"), "is.null");
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return respond(offset === 0 ? pendingBirths : []);
    }
    assert.equal(table, "yokai_states");
    assert.equal(url.searchParams.get("stage"), "eq.active");
    assert.equal(url.searchParams.get("guild_id"), `eq.${testEnv.DISCORD_GUILD_ID}`);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return respond(offset === 0 ? states : []);
  };

  const { now } = await import(
    pathToFileURL(resolve("src/commands/now.ts")).href
  );

  function interaction(guildId = testEnv.DISCORD_GUILD_ID) {
    const calls = [];
    return {
      guildId,
      calls,
      deferReply: async (...args) => calls.push({ method: "deferReply", args }),
      editReply: async (...args) => calls.push({ method: "editReply", args }),
      followUp: async (...args) => calls.push({ method: "followUp", args }),
      reply: async (...args) => calls.push({ method: "reply", args }),
    };
  }

  await t.test("activeの妖怪だけを場所ごとに名前とレベル付きで公開する", async () => {
    states = [
      {
        id: "yokai-2", location_id: "location-2", report_count: 7,
        yokai_name: "ゴミ出しの妖怪", image_key: "yokai_Y02_lv5.png",
        location: { name: "部室" }, taskType: { name: "ごみ出し" },
      },
      {
        id: "yokai-1", location_id: "location-1", report_count: 3,
        yokai_name: "洗い物の妖怪", image_key: "yokai_Y01_lv1.png",
        location: { name: "流し" }, taskType: { name: "洗い物" },
      },
    ];
    requests.length = 0;
    const target = interaction();
    await now.execute(target);

    assert.deepEqual(target.calls[0], { method: "deferReply", args: [] });
    const content = target.calls[1].args[0];
    assert.match(content, /### 部室/);
    assert.match(content, /\*\*ゴミため坊\*\*（ごみ出し）— レベル 5/);
    assert.match(content, /### 流し/);
    assert.match(content, /\*\*あらいわすれ坊\*\*（洗い物）— レベル 1/);
    assert.doesNotMatch(content, /attachment:\/\//);
    assert.equal(requests.filter((item) => item.table === "yokai_states").length, 2);
  });

  await t.test("誕生がまだ妖怪だよりで知らされていない妖怪は、次の妖怪だよりまで出さない", async () => {
    states = [
      {
        id: "yokai-1", location_id: "location-1", report_count: 3,
        yokai_name: "洗い物の妖怪", image_key: "yokai_Y01_lv1.png",
        location: { name: "流し" }, taskType: { name: "洗い物" },
      },
      {
        id: "yokai-2", location_id: "location-2", report_count: 7,
        yokai_name: "ゴミ出しの妖怪", image_key: "yokai_Y02_lv5.png",
        location: { name: "部室" }, taskType: { name: "ごみ出し" },
      },
    ];
    pendingBirths = [{ id: "job-1", yokai_id: "yokai-1" }];
    const target = interaction();
    await now.execute(target);
    const content = target.calls[1].args[0];
    assert.doesNotMatch(content, /あらいわすれ坊/);
    assert.match(content, /ゴミため坊/);

    // まだ知らされていない妖怪しかいなければ「いません」と出す
    states = states.slice(0, 1);
    const onlyNew = interaction();
    await now.execute(onlyNew);
    assert.equal(onlyNew.calls[1].args[0], "現在活動中の妖怪はいません。");
    pendingBirths = [];
  });

  await t.test("雑務ごとの出現回数があれば、それでレベルを数える", async () => {
    states = [{
      id: "yokai-9", location_id: "location-9", task_type_id: "task-9", report_count: 3,
      yokai_name: "器具の妖怪", image_key: "yokai_Y01_lv1.png",
      location: { name: "実験台" }, taskType: { name: "器具の洗浄" },
    }];
    taskThresholds = [{ id: "task-9", birth_threshold: 1 }];
    const target = interaction();
    await now.execute(target);
    // 全体の値（3度目）ならレベル1だが、この雑務は1度目で出現なのでレベル3
    assert.match(target.calls[1].args[0], /レベル 3/);
    taskThresholds = [];
  });

  await t.test("activeの妖怪がいない場合も公開で案内する", async () => {
    states = [];
    const target = interaction();
    await now.execute(target);
    assert.deepEqual(target.calls[1], {
      method: "editReply",
      args: ["現在活動中の妖怪はいません。"],
    });
  });

  await t.test("サーバー外では実行しない", async () => {
    const target = interaction(null);
    await now.execute(target);
    assert.deepEqual(target.calls, [{
      method: "reply",
      args: ["このコマンドはサーバーの中で使ってください。"],
    }]);
  });

  await t.test("コマンド名はnowでGuild限定", () => {
    const json = now.data.toJSON();
    assert.equal(json.name, "now");
    assert.deepEqual(json.contexts, [0]);
  });
});
