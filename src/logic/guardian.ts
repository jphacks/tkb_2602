// 守り神のルール（3番の領域。1番が仮に作った）
// データベースや Discord には触らない。ポイントを渡すと、今の段階や次の進化を返す

export type GuardianKey = "A" | "B" | "C" | "D" | "E";

export const GUARDIANS: Record<GuardianKey, { name: string; description: string }> = {
  A: { name: "白狐", description: "狐火をともし、気づいた人のそばに静かに寄りそう白い狐" },
  B: { name: "狛犬", description: "手まりを守り、場所の平穏を見張る狛犬" },
  C: { name: "水と蓮の女神", description: "清らかな水のしずくで、片づけた手を労う女神" },
  D: { name: "白蛇", description: "鈴をさげ、小さな積み重ねを覚えている白い蛇" },
  E: { name: "雲の龍", description: "雲に乗り、宝珠をたずさえる翡翠の龍" },
};

export const GUARDIAN_KEYS = Object.keys(GUARDIANS) as GuardianKey[];

// まだ選んでいない人の守り神（仕様：間に合わなければ白狐）
export const DEFAULT_GUARDIAN: GuardianKey = "A";

// 段階：ポイントが min 以上になると、その段階になる
export const GUARDIAN_STAGES = [
  { min: 0, level: 1, title: "こまもり" },
  { min: 10, level: 10, title: "かたづけ守り" },
  { min: 30, level: 30, title: "みまもり守り" },
  { min: 60, level: 60, title: "よろず守り" },
  { min: 100, level: 100, title: "せかい守り" },
] as const;

export type GuardianStage = (typeof GUARDIAN_STAGES)[number];

export function isGuardianKey(value: unknown): value is GuardianKey {
  return typeof value === "string" && value in GUARDIANS;
}

export function guardianStage(points: number): GuardianStage {
  return [...GUARDIAN_STAGES].reverse().find((stage) => points >= stage.min) ?? GUARDIAN_STAGES[0];
}

// 次の段階（最後の段階なら null）
export function nextGuardianStage(points: number): GuardianStage | null {
  return GUARDIAN_STAGES.find((stage) => stage.min > points) ?? null;
}

// before → after でポイントが増えたとき、段階が上がったか
export function didGuardianEvolve(before: number, after: number): boolean {
  return guardianStage(after).level > guardianStage(before).level;
}

// 次の姿までの進み具合を、10マスのバーで表す（例：▰▰▰▰▱▱▱▱▱▱ 18 / 30　次の姿まであと12）
const PROGRESS_CELLS = 10;

export function guardianProgressBar(points: number): string {
  const stage = guardianStage(points);
  const next = nextGuardianStage(points);
  if (!next) return `${"▰".repeat(PROGRESS_CELLS)} ${points}　最後の姿です`;
  const filled = Math.floor(((points - stage.min) / (next.min - stage.min)) * PROGRESS_CELLS);
  return `${"▰".repeat(filled)}${"▱".repeat(PROGRESS_CELLS - filled)} ${points} / ${next.min}　次の姿まであと${next.min - points}`;
}

// 画像のファイル名（src/assets/birth/kami_A_lv10.png など）
export function guardianImageKey(key: GuardianKey, points: number): string {
  return `kami_${key}_lv${guardianStage(points).level}.png`;
}
