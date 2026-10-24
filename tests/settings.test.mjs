import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await test("設定保存と設定画面", async (t) => {
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
  const notifyId = "333333333333333333";
  const adminId = "444444444444444444";
  let rpcCalls;
  let getCalls;
  let failure;
  let storedSettings;
  let rpcCheck;
  function reset() {
    rpcCalls = [];
    getCalls = [];
    failure = null;
    rpcCheck = () => {};
    storedSettings = {
      notification_channel_id: notifyId, admin_channel_id: adminId,
      notification_time: "19:30:00", birth_threshold: 5,
    };
  }
  reset();
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, testEnv.SUPABASE_URL);
    const respond = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (request.method === "POST") {
      assert.equal(url.pathname, "/rest/v1/rpc/save_guild_settings");
      rpcCheck();
      rpcCalls.push(await request.json());
      if (failure) return respond(failure, 400);
      return respond(null); // returns void
    }
    assert.equal(request.method, "GET");
    assert.equal(url.searchParams.get("guild_id"), `eq.${guildId}`);
    getCalls.push(url);
    if (url.pathname.endsWith("/guild_settings")) {
      assert.match(url.searchParams.get("select"), /notification_time/);
      return respond(storedSettings ? [storedSettings] : []);
    }
    assert.ok(["/rest/v1/locations", "/rest/v1/task_types"].includes(url.pathname));
    assert.equal(url.searchParams.get("is_active"), "eq.true");
    return respond([{ id: "existing-id", name: "既存の項目" }]);
  };
  console.error = () => {}; // エラー時の画面テストで意図的に発生させるログを抑制
  const settings = await import(pathToFileURL(resolve("src/database/settings.ts")).href);
  const masters = await import(pathToFileURL(resolve("src/database/masters.ts")).href);
  const { youkaiSettei } = await import(pathToFileURL(resolve("src/commands/youkai-settei.ts")).href);
  const { PermissionFlagsBits } = await import("discord.js");
  const basic = {
    notificationChannelId: notifyId, adminChannelId: adminId, digestHour: 19, digestMinute: 30,
  };

  await t.test("基本設定と場所一覧を1回のRPCへ渡し、名前の空白・重複を整える", async () => {
    reset();
    await settings.saveBasicSettings(guildId, basic, [" 流し ", "流し", "", "会議室"]);
    assert.deepEqual(rpcCalls, [{
      p_guild_id: guildId,
      p_settings: {
        notification_channel_id: notifyId, admin_channel_id: adminId,
        digest_hour: 19, digest_minute: 30,
      },
      p_location_names: ["流し", "会議室"], p_task_type_names: null,
    }]);
  });

  await t.test("出現条件と雑務一覧を1回のRPCへ渡し、他の設定は送らない", async () => {
    reset();
    await settings.saveTaskSettings(guildId, 5, ["洗い物", "ごみ出し"]);
    assert.deepEqual(rpcCalls, [{
      p_guild_id: guildId, p_settings: { birth_threshold: 5 },
      p_location_names: null, p_task_type_names: ["洗い物", "ごみ出し"],
    }]);
  });

  await t.test("個別更新も利用でき、未指定と明示的なnullを区別する", async () => {
    reset();
    await settings.saveGuildSettings(guildId, { notificationChannelId: null, adminChannelId: undefined });
    await settings.saveLocationNames(guildId, ["流し"]);
    await settings.saveTaskTypeNames(guildId, ["洗い物"]);
    assert.deepEqual(rpcCalls.map((call) => call.p_settings), [{ notification_channel_id: null }, {}, {}]);
    assert.deepEqual(rpcCalls[1].p_location_names, ["流し"]);
    assert.deepEqual(rpcCalls[2].p_task_type_names, ["洗い物"]);
  });

  await t.test("保存済みの通知時刻を読み、未登録サーバーには初期値を返す", async () => {
    reset();
    assert.deepEqual(await settings.getGuildSettings(guildId), { ...basic, birthThreshold: 5 });
    storedSettings = null;
    assert.deepEqual(await settings.getGuildSettings(guildId), {
      notificationChannelId: null, adminChannelId: null, digestHour: 18, digestMinute: 0, birthThreshold: 3,
    });
    storedSettings = { notification_time: "24:00:00" };
    await assert.rejects(settings.getGuildSettings(guildId), /通知時刻が不正/);
  });

  await t.test("不正な時刻・回数・チャンネル・一覧は保存前に拒否する", async () => {
    reset();
    for (const patch of [
      { digestHour: 24 }, { digestHour: -1 }, { digestMinute: 15 }, { birthThreshold: 0 },
      { birthThreshold: 2.5 }, { birthThreshold: 2147483648 }, { notificationChannelId: "invalid" },
      { digestHour: null }, { digestHour: NaN }, { unknown: true },
    ]) {
      await assert.rejects(settings.saveGuildSettings(guildId, patch), settings.SettingsValidationError);
    }
    for (const names of [[], [" "], ["a".repeat(51)], ["流し\n会議室"], [null]]) {
      await assert.rejects(settings.saveLocationNames(guildId, names), settings.SettingsValidationError);
    }
    await assert.rejects(settings.saveGuildSettings("", {}), settings.SettingsValidationError);
    assert.equal(rpcCalls.length, 0);
  });

  await t.test("DBの入力エラーと通信・内部エラーを呼び出し元へ返す", async () => {
    reset();
    failure = { code: "22023", message: "割り当てられる妖怪がありません。" };
    await assert.rejects(settings.saveTaskSettings(guildId, 5, ["洗い物"]), settings.SettingsValidationError);
    failure = { code: "TEST", message: "DB error" };
    await assert.rejects(settings.saveGuildSettings(guildId, {}), /設定の保存に失敗しました: DB error/);
  });

  await t.test("場所・雑務の読み込みはどちらも有効な項目に絞る", async () => {
    reset();
    await masters.getLocations(guildId);
    await masters.getTaskTypes(guildId);
    assert.equal(getCalls.length, 2);
  });

  function modal(customId, { admin = true, text = "流し\n会議室" } = {}) {
    const events = [];
    return {
      customId, guildId, events,
      memberPermissions: { has: (permission) => {
        assert.equal(permission, PermissionFlagsBits.ManageGuild);
        return admin;
      } },
      fields: {
        getSelectedChannels: (id) => ({ first: () => ({ id: id.endsWith(":notify") ? notifyId : adminId }) }),
        getStringSelectValues: (id) => [id.endsWith(":hour") ? "19" : id.endsWith(":minute") ? "30" : "5"],
        getTextInputValue: () => text,
      },
      message: { content: "基本設定と場所の一覧を保存しました（1/2）" },
      isFromMessage: () => true,
      deferReply: async () => { events.push(["deferReply"]); },
      deferUpdate: async () => { events.push(["deferUpdate"]); },
      reply: async (body) => { events.push(["reply", body]); },
      editReply: async (body) => { events.push(["editReply", body]); },
      followUp: async (body) => { events.push(["followUp", body]); },
    };
  }

  await t.test("モーダル送信時にも管理者権限を再確認する", async () => {
    reset();
    const interaction = modal("youkai-settei:basic", { admin: false });
    await youkaiSettei.handleModal(interaction);
    assert.equal(rpcCalls.length, 0);
    assert.equal(getCalls.length, 0);
    assert.match(interaction.events[0][1].content, /サーバー管理/);
  });

  await t.test("1枚目は応答を保留してから保存し、成功後に次へボタンを出す", async () => {
    reset();
    const interaction = modal("youkai-settei:basic");
    rpcCheck = () => assert.equal(interaction.events[0][0], "deferReply");
    await youkaiSettei.handleModal(interaction);
    assert.equal(rpcCalls.length, 1);
    const response = interaction.events.at(-1)[1];
    assert.match(response.content, /基本設定と場所の一覧を保存しました/);
    assert.doesNotMatch(response.content, /まだ保存/);
    assert.equal(response.components.length, 1);
  });

  await t.test("保存が失敗した1枚目では完了や次へボタンを表示しない", async () => {
    reset();
    failure = { code: "TEST", message: "internal database details" };
    const interaction = modal("youkai-settei:basic");
    await youkaiSettei.handleModal(interaction);
    const response = interaction.events.at(-1)[1];
    assert.equal(typeof response, "string");
    assert.match(response, /保存結果を確認できませんでした/);
    assert.doesNotMatch(response, /internal database details|保存しました/);
  });

  await t.test("2枚目もまとめて保存し、成功した場合だけ完了する", async () => {
    reset();
    const interaction = modal("youkai-settei:tasks", { text: "洗い物\nごみ出し" });
    rpcCheck = () => assert.equal(interaction.events[0][0], "deferUpdate");
    await youkaiSettei.handleModal(interaction);
    assert.equal(rpcCalls.length, 1);
    assert.deepEqual(rpcCalls[0].p_task_type_names, ["洗い物", "ごみ出し"]);
    assert.match(interaction.events.at(-1)[1].content, /一覧を保存しました（2\/2）/);
    assert.deepEqual(interaction.events.at(-1)[1].components, []);

    reset();
    failure = { code: "22023", message: "割り当てられる妖怪がありません。" };
    const failed = modal("youkai-settei:tasks");
    await youkaiSettei.handleModal(failed);
    assert.equal(failed.events.at(-1)[0], "followUp");
    assert.match(failed.events.at(-1)[1].content, /割り当てられる妖怪がありません/);
    assert.equal(failed.events.some(([name]) => name === "editReply"), false);
  });

  await t.test("設定画面を再度開くと、DBから読んだ時刻・出現条件が選択済みになる", async () => {
    reset();
    let opened;
    const interaction = {
      guildId, memberPermissions: { has: () => true },
      showModal: async (value) => { opened = value.toJSON(); },
    };
    await youkaiSettei.execute(interaction);
    const labels = opened.components;
    assert.equal(labels[2].component.options.find((option) => option.default).value, "19");
    assert.equal(labels[3].component.options.find((option) => option.default).value, "30");
    await youkaiSettei.handleComponent({ ...interaction, customId: "youkai-settei:open-tasks" });
    assert.equal(opened.components[0].component.options.find((option) => option.default).value, "5");
  });
});
