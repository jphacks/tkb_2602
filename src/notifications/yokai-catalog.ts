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

// 誕生したときのカードに出す、ひとことの紹介文（だれかを責める言い方にはしない）
export const YOKAI_INTROS: Record<string, string> = {
  Y01: "洗われないまま置かれた器具に宿る妖怪。スポンジを帽子にして、のんびりあくびをしている。",
  Y02: "あふれそうなゴミ箱に住みつく妖怪。ふたを帽子のようにかたむけて、得意げに笑っている。",
  Y03: "出しっぱなしの物や空き箱から生まれる妖怪。通り道のまんなかに座りこむのが好き。",
  Y04: "共用の机に広げたままの物から生まれる妖怪。両手を広げて、机をひとりじめしようとする。",
  Y05: "元の場所に戻らなかった器具の妖怪。小さな風呂敷をかついで、こっそり旅に出ようとしている。",
  Y06: "消し忘れた明かりを、もぐもぐ食べて育つ妖怪。しっぽはコンセントのプラグ。",
  Y07: "つけっぱなしの空調から生まれた風の妖怪。ほおをふくらませて、休まず風を吹いている。",
  Y08: "冷蔵庫の奥で忘れられた物に宿る妖怪。霜をかぶって、ねむそうに笑っている。",
  Y09: "お手入れを忘れた機械の上に住む、ふわふわの妖怪。いまにもくしゃみをしそう。",
  Y10: "空のまま補充されなかった備品の妖怪。空き箱を帽子にして、肩をすくめている。",
};

const IMAGE_KEY_PATTERN = /^yokai_(Y(?:0[1-9]|10))_lv(?:1|5|10|25)\.png$/;

// 画像のファイル名から紹介文を探す（AIで作った妖怪などには紹介文がないので null）
export function yokaiIntroFromImageKey(imageKey: string | null): string | null {
  const yokaiKey = imageKey?.match(IMAGE_KEY_PATTERN)?.[1];
  return yokaiKey ? YOKAI_INTROS[yokaiKey] ?? null : null;
}

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
