import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// 新しく追加した項目の妖怪を AI で作る部分のテスト（Cloudflare には実際にはつながない）
await test("AIで作る妖怪（Cloudflare Workers AI）", async (t) => {
  const testEnv = {
    DISCORD_TOKEN: "test-token",
    DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_GUILD_ID: "222222222222222222",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "test-only-secret",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "test-token",
  };
  const previousEnv = new Map(Object.keys(testEnv).map((key) => [key, process.env[key]]));
  Object.assign(process.env, testEnv);
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  let requests = [];
  let reply;

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // Cloudflare の代わりに、決まった返事を返す
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, body: await request.clone().json() });
    return reply();
  };
  console.error = () => {};
  console.log = () => {};
  const ok = (result) => () =>
    new Response(JSON.stringify({ success: true, result }), { headers: { "Content-Type": "application/json" } });

  const ai = await import(pathToFileURL(resolve("src/ai/custom-yokai.ts")).href);
  const cloudflare = await import(pathToFileURL(resolve("src/ai/cloudflare.ts")).href);
  const announce = await import(pathToFileURL(resolve("src/ai/announce.ts")).href);

  await t.test("AIの返事が正しければ、その名前と見た目を使う", async () => {
    requests = [];
    reply = ok({ response: '{"name": "かみづまり小僧", "visual": "a small office printer with a crumpled paper jam sticking out"}' });
    const idea = await ai.think("紙詰まり");
    assert.equal(idea.name, "かみづまり小僧");
    assert.match(idea.visual, /printer/);
  });

  await t.test("返事が読み取り済みのオブジェクトで返ってきても使える（Cloudflare の JSON の返し方）", async () => {
    reply = ok({ response: { name: "かみはれ", visual: "a jammed paper shredder with a torn piece of paper stuck inside" } });
    const idea = await ai.think("紙詰まり");
    assert.equal(idea.name, "かみはれ");
    assert.match(idea.visual, /shredder/);
  });

  await t.test("AIに渡すのは、管理者が登録した項目の名前だけ", async () => {
    requests = [];
    reply = ok({ response: '{"name": "かみづまり小僧", "visual": "a small office printer with a paper jam"}' });
    await ai.think("紙詰まり");
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/ai\/run\/@cf\/meta\//);
    const user = requests[0].body.messages.filter((m) => m.role === "user");
    assert.deepEqual(user.map((m) => m.content), ["Neglected chore: 紙詰まり"]);
  });

  await t.test("AIの返事が壊れていたら、決まった名前に戻す", async () => {
    reply = ok({ response: "すみません、うまく作れませんでした" });
    const idea = await ai.think("紙詰まり");
    assert.equal(idea.name, "紙詰まりの妖怪");
    assert.ok(idea.visual.length > 10);
  });

  await t.test("名前に英字や記号、長すぎる名前が入っていたら、決まった名前に戻す", async () => {
    for (const name of ["Paper Jam Yokai", "かみ<script>", "あ".repeat(30)]) {
      reply = ok({ response: JSON.stringify({ name, visual: "a small office printer with a paper jam" }) });
      assert.equal((await ai.think("紙詰まり")).name, "紙詰まりの妖怪", name);
    }
  });

  await t.test("Cloudflare がエラーを返しても、止まらずに決まった名前で続ける", async () => {
    reply = () => new Response(JSON.stringify({ success: false, errors: [{ message: "daily free allocation exceeded" }] }), { status: 429 });
    const idea = await ai.think("紙詰まり");
    assert.equal(idea.name, "紙詰まりの妖怪");
  });

  await t.test("画像のエラーは、理由つきで呼び出し側に伝える", async () => {
    reply = () => new Response(JSON.stringify({ success: false, errors: [{ message: "daily free allocation exceeded" }] }), { status: 429 });
    await assert.rejects(cloudflare.generateImage("x"), /daily free allocation exceeded/);
  });

  await t.test("画像の指示文は、画風の指定と「文字を描かない」を必ず含む", () => {
    const prompt = ai.imagePrompt("a small office printer with a paper jam");
    assert.match(prompt, /a small office printer with a paper jam/);
    assert.match(prompt, /cel shading/);
    assert.match(prompt, /no text/);
    assert.match(prompt, /no humans/);
  });

  await t.test("Cloudflare の設定がなければ、AIは呼ばずに今までどおり動く", async () => {
    requests = [];
    delete process.env.CLOUDFLARE_API_TOKEN;
    assert.equal(cloudflare.isCloudflareConfigured(), false);
    announce.startCustomYokaiCreation({}, "g", "00000000-0000-0000-0000-000000000000", "紙詰まり");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(requests.length, 0);
    process.env.CLOUDFLARE_API_TOKEN = testEnv.CLOUDFLARE_API_TOKEN;
  });
});
