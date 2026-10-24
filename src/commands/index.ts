import type { Command } from "./types.js";
import { demo } from "./demo.js";
import { now } from "./now.js";
import { summary } from "./summary.js";
import { youkai } from "./youkai.js";
import { youkaiSettei } from "./youkai-settei.js";

// ボットが持つコマンドの一覧（1番）
// 新しいコマンドを作ったら、ここに足すだけで登録と振り分けの両方に反映される
export const commands: Command[] = [youkai, youkaiSettei, summary, now, demo];
