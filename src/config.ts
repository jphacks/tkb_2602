import { config } from "dotenv";

// .env.local から設定を読み込む（トークンや鍵はここにだけ書く）
config({ path: ".env.local", quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} が .env.local に設定されていません（.env.example を見本にしてください）`);
  }
  return value;
}

export const discordToken = required("DISCORD_TOKEN");
export const discordClientId = required("DISCORD_CLIENT_ID");
export const discordGuildId = required("DISCORD_GUILD_ID");
export const supabaseUrl = required("SUPABASE_URL");
export const supabaseSecretKey = required("SUPABASE_SECRET_KEY");
