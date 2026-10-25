// 片づけの偏り（かたより坊）（1番）
// 「片づけるのは、いつも同じ人」という偏りそのものを、人ではなく妖怪として研究室に見せる。
// 誰が片づけたかは出さない。段階だけを出し、人数や割合は出さない。
//
// 偏り度 ＝ いちばん多く片づけた1人の割合 ÷（1 ÷ 研究室の人数）
//   ＝ みんなで同じだけ片づけたときの、何倍を1人が担っているか
// 例：9人の研究室で1人が 1/3 を担っていれば、偏り度は3（かたより坊が出現）

export type BiasStage = "healthy" | "presence" | "active" | "unknown";

export const BIAS_PRESENCE_RATIO = 2; // これ以上で「気配」
export const BIAS_ACTIVE_RATIO = 3; // これ以上で「出現」
export const MIN_CONTRIBUTORS = 3; // 片づけた人がこれより少ないと、誰のことか分かってしまうので出さない
export const MIN_TOTAL_POINTS = 10; // 片づけの合計がこれより少ないと、たまたまの偏りなので出さない

// points：研究室のメンバーそれぞれの守り神ポイント（片づけの回数）。memberCount：研究室（サーバー）の人数
export function biasStage(points: number[], memberCount: number): BiasStage {
  const contributors = points.filter((p) => p > 0);
  const total = contributors.reduce((sum, p) => sum + p, 0);
  if (contributors.length < MIN_CONTRIBUTORS || total < MIN_TOTAL_POINTS || memberCount < MIN_CONTRIBUTORS) {
    return "unknown";
  }
  const ratio = (Math.max(...contributors) / total) * memberCount;
  if (ratio >= BIAS_ACTIVE_RATIO) return "active";
  if (ratio >= BIAS_PRESENCE_RATIO) return "presence";
  return "healthy";
}

// 妖怪だよりの最後に添える文（気配・出現のときだけ）
export function biasDigestLines(stage: BiasStage): string[] {
  if (stage === "presence") {
    return ["", "- 片づけの分担：少し偏ってきたようです（かたより坊の気配）"];
  }
  if (stage === "active") {
    return [
      "",
      "### 🌀 かたより坊が現れました",
      "片づけが、一部の人に集まっています。誰が、とは言いません。",
      "- お祓いの作法：当番や置き場所を、研究室で話し合ってみよう",
    ];
  }
  return [];
}

// 本人にだけ見せる、自分が担った割合（10%きざみに丸める）
export function myShareText(myPoints: number, totalPoints: number): string | null {
  if (myPoints <= 0 || totalPoints <= 0) return null;
  const share = myPoints / totalPoints;
  if (share < 0.05) return "この研究室の片づけのうち、あなたが担ったのは1割未満です";
  return `この研究室の片づけのうち、あなたが担ったのは約${Math.max(10, Math.round(share * 10) * 10)}%です`;
}
