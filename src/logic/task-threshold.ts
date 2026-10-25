// 雑務ごとの「何回目で妖怪が出現するか」（1番）
// /youkai-settei の一覧に「器具の洗浄=1」のように書くと、その雑務だけ出現回数を変えられる。
// 書かなければ、サーバー全体の値（何度目に妖怪が出現するか）を使う。

export const MIN_TASK_THRESHOLD = 1;
export const MAX_TASK_THRESHOLD = 10;

// 全角の数字・記号も受け付ける
function toHalfWidth(text: string) {
  return text.replace(/[０-９＝]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

export type TaskLine = { name: string; threshold: number | null; error?: string };

// 1行を「名前」と「出現回数」に分ける。「=数字」がなければ出現回数は null
export function splitTaskLine(line: string): TaskLine {
  const match = /^(.+?)\s*=\s*(\d+)\s*$/.exec(toHalfWidth(line.trim()));
  if (!match) return { name: line.trim(), threshold: null };
  const name = line.trim().slice(0, match[1].length).trim();
  const threshold = Number(match[2]);
  if (threshold < MIN_TASK_THRESHOLD || threshold > MAX_TASK_THRESHOLD) {
    return { name, threshold: null, error: `「${name}」の回数は${MIN_TASK_THRESHOLD}〜${MAX_TASK_THRESHOLD}にしてください` };
  }
  return { name, threshold };
}

// 設定画面に出すときの1行（出現回数があれば「名前=回数」）
export function formatTaskLine(name: string, threshold: number | null | undefined) {
  return threshold ? `${name}=${threshold}` : name;
}
