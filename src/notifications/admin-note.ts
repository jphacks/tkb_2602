// 管理者チャンネルに届ける「ひとこと」の文章（4番の領域）
// ※ 1番が仮に作った文章だけの版。見た目は4番が自由に作り直してください
//   報告者の名前やIDは、ここに絶対に入れない

export type AdminNoteContext = {
  locationName: string;
  taskTypeName: string;
  note: string;
};

export function adminNoteMessage(context: AdminNoteContext): string {
  // 引用（> ）の中で改行されても崩れないように、各行の頭に > を付ける
  const quoted = context.note
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return [
    "📝 **観測書にひとことが届きました**",
    `場所：${context.locationName}`,
    `やり残されていたこと：${context.taskTypeName}`,
    quoted,
    "-# 一覧にないものなら、/youkai-settei で一覧に追加できます",
  ].join("\n");
}
