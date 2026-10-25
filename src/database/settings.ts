import { supabase } from "./client.js";

export type GuildSettings = {
  notificationChannelId: string | null; // まとめ通知を送るチャンネル（#毎日報告）
  adminChannelId: string | null; // 管理者に「ひとこと」を届けるチャンネル
  digestHour: number; // まとめ通知を送る時刻の「時」（0〜23）
  digestMinute: number; // まとめ通知を送る時刻の「分」（0 または 30）
  birthThreshold: number; // 何度目の記録で妖怪が出現するか
};

type SettingsRow = {
  notification_channel_id: string | null;
  admin_channel_id: string | null;
  notification_time: string;
  birth_threshold: number;
};

// 入力を直せば保存できるエラー。通信障害や内部エラーとは分けて画面に伝える。
export class SettingsValidationError extends Error {}

function validateGuildId(guildId: string) {
  if (typeof guildId !== "string" || !guildId.trim()) {
    throw new SettingsValidationError("サーバーIDを指定してください。");
  }
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  validateGuildId(guildId);
  const { data, error } = await supabase
    .from("guild_settings")
    .select("notification_channel_id, admin_channel_id, notification_time, birth_threshold")
    .eq("guild_id", guildId)
    .maybeSingle<SettingsRow>();
  if (error) throw error;

  const time = data?.notification_time ?? "18:00:00";
  const match = /^(\d{2}):(00|30):00(?:\.0+)?$/.exec(time);
  if (!match || Number(match[1]) > 23) {
    throw new Error("保存されている通知時刻が不正です。");
  }

  return {
    notificationChannelId: data?.notification_channel_id ?? null,
    adminChannelId: data?.admin_channel_id ?? null,
    digestHour: Number(match[1]),
    digestMinute: Number(match[2]),
    birthThreshold: data?.birth_threshold ?? 3,
  };
}

function settingsPatch(settings: Partial<GuildSettings>): Record<string, string | number | null> {
  const fields = {
    notificationChannelId: "notification_channel_id",
    adminChannelId: "admin_channel_id",
    digestHour: "digest_hour",
    digestMinute: "digest_minute",
    birthThreshold: "birth_threshold",
  } as const;
  const patch: Record<string, string | number | null> = {};
  for (const key of Object.keys(settings)) {
    if (!Object.hasOwn(fields, key)) throw new SettingsValidationError("未対応の設定項目です。");
    const field = key as keyof GuildSettings;
    const value = settings[field];
    // undefinedは「変更しない」、チャンネルのnullは「設定を解除する」。
    if (value === undefined) continue;
    if (field === "notificationChannelId" || field === "adminChannelId") {
      if (value !== null && (typeof value !== "string" || !/^\d{17,20}$/.test(value))) {
        throw new SettingsValidationError("チャンネルIDが不正です。");
      }
    } else if (typeof value !== "number" || !Number.isInteger(value)
      || (field === "digestHour" && (value < 0 || value > 23))
      || (field === "digestMinute" && value !== 0 && value !== 30)
      || (field === "birthThreshold" && (value < 1 || value > 2147483647))) {
      throw new SettingsValidationError("通知時刻または出現回数が不正です。");
    }
    patch[fields[field]] = value;
  }
  return patch;
}

function normalizeNames(names: string[]): string[] {
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
    throw new SettingsValidationError("一覧には名前を指定してください。");
  }
  const normalized = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (normalized.length === 0) throw new SettingsValidationError("一覧には1つ以上書いてください。");
  if (normalized.some((name) => [...name].length > 50 || /[\r\n]/.test(name))) {
    throw new SettingsValidationError("名前は改行を含めず、50文字以内にしてください。");
  }
  return normalized;
}

async function saveConfiguration(
  guildId: string,
  settings: Partial<GuildSettings>,
  locationNames?: string[],
  taskTypeNames?: string[],
): Promise<void> {
  validateGuildId(guildId);
  const { error } = await supabase.rpc("save_guild_settings", {
    p_guild_id: guildId,
    p_settings: settingsPatch(settings),
    p_location_names: locationNames === undefined ? null : normalizeNames(locationNames),
    p_task_type_names: taskTypeNames === undefined ? null : normalizeNames(taskTypeNames),
  });
  if (error) {
    if (error.code === "22023") throw new SettingsValidationError(error.message);
    throw new Error(`設定の保存に失敗しました: ${error.message}`);
  }
}

// 1枚のモーダルの変更を、1回のRPC（トランザクション）でまとめて保存する。
export async function saveBasicSettings(
  guildId: string,
  settings: Pick<GuildSettings, "notificationChannelId" | "adminChannelId" | "digestHour" | "digestMinute">,
  names: string[],
): Promise<void> {
  await saveConfiguration(guildId, settings, names);
}

export async function saveTaskSettings(guildId: string, birthThreshold: number, names: string[]): Promise<void> {
  await saveConfiguration(guildId, { birthThreshold }, undefined, names);
}

// 個別の更新にも対応。省略した設定や一覧は変更しない。
export async function saveGuildSettings(guildId: string, settings: Partial<GuildSettings>): Promise<void> {
  await saveConfiguration(guildId, settings);
}

export async function saveLocationNames(guildId: string, names: string[]): Promise<void> {
  await saveConfiguration(guildId, {}, names);
}

export async function saveTaskTypeNames(guildId: string, names: string[]): Promise<void> {
  await saveConfiguration(guildId, {}, undefined, names);
}
