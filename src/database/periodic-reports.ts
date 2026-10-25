import { supabase } from "./client.js";
import { getNow } from "../time.js";

export type PeriodicReportOptions = {
  from: Date;
  to?: Date;
};

export type PeriodicReportYokai = {
  yokaiId: string;
  locationId: string;
  locationName: string;
  taskTypeId: string;
  taskTypeName: string;
  yokaiKey: string;
  stage: "active" | "ascended";
  yokaiLevel: number;
  reportCount: number;
  periodReportCount: number;
  lastReportedAt: string | null;
  bornAt: string;
  ascendedAt: string | null;
};

export type PeriodicReport = {
  guildId: string;
  notificationChannelId: string | null;
  timezone: string;
  periodStart: string;
  periodEnd: string;
  periodReportCount: number;
  yokai: PeriodicReportYokai[];
};

type GuildSettingsRow = {
  notification_channel_id: string | null;
  timezone: string;
  birth_threshold: number;
};

type YokaiStateRow = {
  id: string;
  location_id: string;
  task_type_id: string;
  report_count: number;
  stage: "active" | "ascended";
  last_reported_at: string | null;
  born_at: string | null;
  ascended_at: string | null;
  location: { name: string } | null;
  taskType: { name: string; yokai_key: string } | null;
};

type ReportRow = {
  id: string;
  location_id: string;
  task_type_id: string;
  task_kind: "abnormal" | "routine";
};

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

// APIの返却上限で集計が途切れないよう、実際に返った件数で進める。
async function readAllPages<T>(
  readPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;

  while (true) {
    const { data, error } = await readPage(rows.length, rows.length + pageSize - 1);
    if (error) {
      throw new Error(`${label}の取得に失敗しました: ${error.message}`);
    }
    if (!data) {
      throw new Error(`${label}の取得結果がありません`);
    }
    if (data.length === 0) return rows;
    rows.push(...data);
  }
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * 定期通知に渡す、誕生済み妖怪の現在状態と期間内の報告件数を取得する。
 * 期間は from 以上・to 未満。to 省略時は getNow() を使う。
 * DB更新・Discord送信・個人のポイント取得は行わない。
 */
export async function getPeriodicReport(
  guildId: string,
  options: PeriodicReportOptions,
): Promise<PeriodicReport> {
  if (typeof guildId !== "string" || !guildId.trim()) {
    throw new Error("サーバーIDを指定してください");
  }
  if (!options || !validDate(options.from)
    || (options.to !== undefined && !validDate(options.to))) {
    throw new Error("集計期間には有効なDateを指定してください");
  }

  const to = options.to ?? await getNow(guildId);
  if (options.from.getTime() >= to.getTime()) {
    throw new Error("集計開始日時は終了日時より前にしてください");
  }
  const periodStart = options.from.toISOString();
  const periodEnd = to.toISOString();

  const { data: settings, error } = await supabase
    .from("guild_settings")
    .select("notification_channel_id, timezone, birth_threshold")
    .eq("guild_id", guildId)
    .maybeSingle<GuildSettingsRow>();

  if (error) {
    throw new Error(`サーバー設定の取得に失敗しました: ${error.message}`);
  }
  if (!settings) throw new Error("サーバー設定が登録されていません");
  if (!Number.isInteger(settings.birth_threshold) || settings.birth_threshold < 1) {
    throw new Error("妖怪の誕生に必要な報告回数の設定が不正です");
  }

  const states = await readAllPages<YokaiStateRow>(
    (from, to) => supabase
      .from("yokai_states")
      .select(`
        id, location_id, task_type_id, report_count, stage,
        last_reported_at, born_at, ascended_at,
        location:locations(name),
        taskType:task_types(name, yokai_key)
      `)
      .eq("guild_id", guildId)
      .in("stage", ["active", "ascended"])
      .not("born_at", "is", null)
      .order("id")
      .range(from, to)
      .returns<YokaiStateRow[]>(),
    "妖怪の状態",
  );

  const reports = await readAllPages<ReportRow>(
    (from, to) => supabase
      .from("reports")
      .select("id, location_id, task_type_id, task_kind")
      .eq("guild_id", guildId)
      .gte("created_at", periodStart)
      .lt("created_at", periodEnd)
      .order("id")
      .range(from, to)
      .returns<ReportRow[]>(),
    "期間内の報告",
  );

  const counts = new Map<string, number>();
  for (const report of reports) {
    // 全記録の件数には含めるが、いつもの仕事を妖怪の期間内観測数には数えない。
    if (report.task_kind === "routine") continue;
    const key = `${report.location_id}:${report.task_type_id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const yokai = states.map((state): PeriodicReportYokai => {
    if (!state.location || !state.taskType || !state.born_at) {
      throw new Error("妖怪に対応する場所・雑務・誕生日時が取得できませんでした");
    }
    return {
      yokaiId: state.id,
      locationId: state.location_id,
      locationName: state.location.name,
      taskTypeId: state.task_type_id,
      taskTypeName: state.taskType.name,
      yokaiKey: state.taskType.yokai_key,
      stage: state.stage,
      yokaiLevel: Math.max(0, state.report_count - settings.birth_threshold + 1),
      reportCount: state.report_count,
      periodReportCount: counts.get(`${state.location_id}:${state.task_type_id}`) ?? 0,
      lastReportedAt: state.last_reported_at,
      bornAt: state.born_at,
      ascendedAt: state.ascended_at,
    };
  });

  return {
    guildId,
    notificationChannelId: settings.notification_channel_id,
    timezone: settings.timezone,
    periodStart,
    periodEnd,
    periodReportCount: reports.length,
    yokai,
  };
}
