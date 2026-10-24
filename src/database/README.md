# DB操作

## 定期報告用のデータ取得

`periodic-reports.ts`の`getPeriodicReport(guildId, { from, to })`を呼びます。
既存のSupabase接続とテーブルを使うため、追加SQLの実行は不要です。

```ts
// src/notifications/ から呼び出す例
import { getPeriodicReport } from "../database/periodic-reports.js";
import { getNow } from "../time.js";

const to = await getNow(guildId);
const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
const report = await getPeriodicReport(guildId, { from, to });

// report.notificationChannelId：通知先。未設定ならnull
// report.periodReportCount：期間内の報告件数（気配・影も含む全報告）
for (const yokai of report.yokai) {
  // locationName / taskTypeName / yokaiKey：表示・画像選択に使用
  // stage：active または ascended
  // yokaiLevel / reportCount：現在のレベル・累計報告回数
  // periodReportCount：その場所×雑務の期間内報告回数
  // lastReportedAt / bornAt / ascendedAt：日時（UTCの文字列、またはnull）
}
```

- 期間は **from以上・to未満** です。隣り合う期間の境界を二重集計しません。
- `to`を省略すると`getNow(guildId)`を使います。`from`は必須です。
- 上記は直近24時間の例です。日付単位や毎日18時締めの期間は、呼び出し側で指定してください。
- 妖怪一覧は取得時点の状態です。指定期間の終了時点の過去状態を復元するものではありません。
- 気配・影は一覧に含めません。誕生済みで`active`または`ascended`の妖怪を返します。
- 成仏済みの妖怪も含みます。今回成仏したものだけを掲載する場合は、`ascendedAt`を期間で絞ってください。
- 報告者ID、本人用キー、個人ポイント、自由記述は取得・返却しません。
- 報告も妖怪もない場合は`periodReportCount: 0`、`yokai: []`です。
- DBエラーや未登録のサーバーは例外にします。通信失敗を「報告0件」として表示しないでください。
- DB更新、成仏判定、定期実行、Discordへの送信は行いません。
- 複数の参照クエリを使うため、取得中に報告が確定すると、現在の累計と期間件数に一時的な差が出る場合があります。

必要な実行環境は既存のBotと同じです。`.env.local`を設定し、サーバー側から呼び出してください。

## テスト

```bash
npm run typecheck
npm test
```

HTTP応答をモックし、期間境界、別サーバーの分離、気配・影の非公開、ページ分割、エラー処理を確認します。
実際のSupabaseへの接続や書き込みは行いません。
