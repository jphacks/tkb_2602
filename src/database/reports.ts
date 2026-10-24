import { supabase } from "./client.js";

export type ReportInput = {
  requestId: string;
  guildId: string;
  locationId: string;
  taskTypeId: string;
  memberKey: string;
  // アプリの中の「今」（getNow()）。デモで時間を進めているときだけ渡す。省略したらデータベースの本当の今
  now?: Date;
};

export type ReportResult = {
  duplicate: boolean;
  points: number;
  yokaiId: string;
  reportCount: number;
  stage: "presence" | "shadow" | "active" | "ascended";
  yokaiLevel: number;
};

export async function submitReport(
  input: ReportInput,
): Promise<ReportResult> {
  const { data, error } = await supabase.rpc("submit_report", {
    p_request_id: input.requestId,
    p_guild_id: input.guildId,
    p_location_id: input.locationId,
    p_task_type_id: input.taskTypeId,
    p_member_key: input.memberKey,
    // 時間を進めていないときは送らない（p_now の追加前の関数でも動くように）
    ...(input.now ? { p_now: input.now.toISOString() } : {}),
  });

  if (error) {
    throw new Error(`報告の保存に失敗しました: ${error.message}`);
  }

  if (!data || typeof data !== "object") {
    throw new Error("報告結果を取得できませんでした");
  }

  return data as ReportResult;
}