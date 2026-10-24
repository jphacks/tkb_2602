// task_types.yokai_key（Y01〜Y10）に対応する正式な妖怪名。
// 画像の命名規則 yokai_Yxx_lvN.png と同じキーを使う。
export const YOKAI_NAMES: Record<string, string> = {
  Y01: "あらいわすれ坊",
  Y02: "ゴミため坊",
  Y03: "おきっぱ小僧",
  Y04: "つくえふさぎ",
  Y05: "もどらずピペット",
  Y06: "あかり喰い",
  Y07: "ふきっぱ風神",
  Y08: "ひえひえ忘れん坊",
  Y09: "ほこりもくもく",
  Y10: "からっぽ狸",
};

const IMAGE_KEY_PATTERN = /^yokai_(Y(?:0[1-9]|10))_lv(?:1|5|10|25)\.png$/;

export function canonicalYokaiNameFromImageKey(
  imageKey: string | null,
): string | null {
  const yokaiKey = imageKey?.match(IMAGE_KEY_PATTERN)?.[1];
  return yokaiKey ? YOKAI_NAMES[yokaiKey] ?? null : null;
}

export function displayYokaiName(
  storedName: string | null,
  imageKey: string | null,
): string {
  return canonicalYokaiNameFromImageKey(imageKey) ?? storedName ?? "名前未設定の妖怪";
}
