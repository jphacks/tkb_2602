import type { Command } from "./types.js";
import { taiji } from "./taiji.js";

// ボットが持つコマンドの一覧（1番）
// 新しいコマンドを作ったら、ここに足すだけで登録と振り分けの両方に反映される
export const commands: Command[] = [taiji];
