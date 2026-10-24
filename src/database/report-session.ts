// 既存プロジェクトの .env.local 読み込みを利用する
import "../config.js";
import { createHmac, randomUUID } from "node:crypto";

export function createReportSession(
  guildId: string,
  userId: string,
) {
  const memberSecret = process.env.MEMBER_KEY_SECRET;

  if (!memberSecret) {
    throw new Error("MEMBER_KEY_SECRETが未設定です");
  }

  const memberKey = createHmac("sha256", memberSecret)
    .update(`${guildId}:${userId}`)
    .digest("hex");

  return {
    requestId: randomUUID(),
    guildId,
    userId,
    memberKey,
  };
}