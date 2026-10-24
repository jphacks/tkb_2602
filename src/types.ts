// 担当どうしで受け渡すデータの形（全員で決める。変えるときはチームに一声かける）
// ※ いまは「案」。最初の話し合いで決まった内容に合わせて直す

// 場所・雑務の一覧の1件。画面には name、内部では id を使う
export type MasterItem = {
  id: string;
  name: string;
};

// /youkai で1回報告されたときの中身（1番 → 2番・3番 に渡す）
// 報告者IDは守り神のポイントのためだけに使い、表示や通知には絶対に出さない
export type ReportInput = {
  requestId: string; // Discordのインタラクションのid（二重登録を防ぐ）
  guildId: string;
  reporterId: string;
  locationId: string;
  taskTypeId: string;
  reportedAt: Date; // 必ず getNow() の値を入れる
};

// ゲームのルール（3番）が返す「出来事」の案
export type GameEvent =
  | { type: "presence" } // 1回目：気配
  | { type: "shadow" } // 2回目：影
  | { type: "birth"; yokaiId: string } // 3回目：誕生
  | { type: "level_up"; yokaiId: string; level: number }; // 4回目以降
