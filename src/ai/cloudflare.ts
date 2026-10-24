// Cloudflare Workers AI（無料の範囲で使う。1日 10,000 ニューロンまで。超えると課金ではなくエラーになる）
// .env.local に CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN を入れる。なければ AI は使わない

const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export function isCloudflareConfigured() {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
}

async function run<T>(model: string, body: unknown): Promise<T> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が .env.local に設定されていません");

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const json = (await response.json().catch(() => null)) as { success?: boolean; result?: T; errors?: { message: string }[] } | null;
  if (!response.ok || !json?.success || !json.result) {
    const reason = json?.errors?.map((e) => e.message).join(" / ") || `HTTP ${response.status}`;
    throw new Error(`Cloudflare Workers AI（${model}）の呼び出しに失敗しました: ${reason}`);
  }
  return json.result;
}

// 文章のAI。返事の文字列を返す
export async function generateText(system: string, user: string): Promise<string> {
  const result = await run<{ response?: string }>(TEXT_MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 300,
    temperature: 0.7,
  });
  return result.response ?? "";
}

// 画像のAI（FLUX.1 schnell）。JPEG の画像を返す
export async function generateImage(prompt: string): Promise<Buffer> {
  const result = await run<{ image?: string }>(IMAGE_MODEL, { prompt, steps: 8 });
  if (!result.image) throw new Error("画像が返ってきませんでした");
  return Buffer.from(result.image, "base64");
}
