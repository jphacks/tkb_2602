// 妖怪の名前の一覧（4番の領域）
// task_types.yokai_key（Y01〜Y10）から、表示する名前を引く
// 名前は yokai_image_prompts.md（画像の指示書）に合わせている。変えるときは画像の指示書もそろえる

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

export function yokaiName(yokaiKey: string | null | undefined): string {
  return (yokaiKey && YOKAI_NAMES[yokaiKey]) || "名もなき妖怪";
}
