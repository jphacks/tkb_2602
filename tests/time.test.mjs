import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await test("getNow() と時間のずれ", async (t) => {
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
  const originalConsoleError = console.error;
  let response;

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  globalThis.fetch = async (input) => {
    const url = new URL(new Request(input).url);
    assert.equal(url.pathname.split("/").at(-1), "guild_settings");
    return response();
  };
  console.error = () => {};

  const { getNow } = await import(pathToFileURL(resolve("src/time.ts")).href);
  const json = (body, status = 200) => () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  await t.test("ずれがあれば、その分だけ進んだ時刻を返す", async () => {
    response = json([{ time_offset_seconds: 4 * 24 * 60 * 60 }]);
    const diff = (await getNow("g")).getTime() - Date.now();
    assert.ok(Math.abs(diff - 4 * 24 * 60 * 60 * 1000) < 5000, `ずれ ${diff}ms`);
  });

  await t.test("ずれを読めないときは、本当の今で動き続ける", async () => {
    response = json({ message: "column guild_settings.time_offset_seconds does not exist" }, 400);
    const diff = (await getNow("g")).getTime() - Date.now();
    assert.ok(Math.abs(diff) < 5000, `ずれ ${diff}ms`);
  });
});
