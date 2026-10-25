# DB操作

## 設定画面からの保存

### 最初にSupabaseへ適用するSQL

1. Supabaseの対象プロジェクトでSQL Editorを開きます。
2. `sql/functions/save_guild_settings.sql`の全文を貼り、Runを押します。
3. 成功後、変更したBotを再起動し、`/youkai-settei`を開きます。

このSQLは既存テーブルに`notification_time`（通知時刻）を追加し、保存用のDB関数を作ります。
既存の通知時刻は18:00になります。適用済みのSQLを再実行しても設定は初期化しません。
先にSQLを適用してください。未適用の状態では、設定画面の読み込み・保存でエラーになります。
コマンド名・項目の登録内容は変えていないため、この変更だけなら`npm run deploy`は不要です。

### 保存されるもの

| 画面 | 保存先 | 内容 |
| --- | --- | --- |
| 1枚目 | `guild_settings`、`locations` | 通知先、管理者向けチャンネル、通知時刻、場所の一覧 |
| 2枚目 | `guild_settings`、`task_types` | 出現に必要な報告回数、雑務の一覧、対応する妖怪キー |

1枚の画面の変更は1回のRPCで保存します。その途中で失敗した場合は、その画面の変更をすべて取り消します。
1枚目の保存後に2枚目をキャンセルした場合、1枚目の変更は保存済みです。
保存完了の表示は、DBから成功応答を受けた後に出します。
通信が途切れて結果が分からない場合は、画面を開き直して確認してください。同じ内容の再送で項目は増殖しません。

- サーバーが未登録なら、初回保存時に`guild_settings`の行も作ります。
- 渡されていない設定項目や一覧は変更しません。チャンネルに明示的に`null`を渡すと解除します。
- 名前の前後の空白と重複は取り除き、名前は1〜50文字とします。空の一覧は保存できません。
- 一覧から外れた項目は削除せず、`is_active = false`にします。報告・妖怪との関連は残ります。
- 同じ名前を戻すと、同じID・同じ妖怪キーのまま有効に戻します。名前変更は「旧項目の無効化＋新項目の追加」です。
- 新しい雑務には、名前に含まれる語から妖怪キーを選びます。
  `洗→Y01`、`ゴミ・ごみ→Y02`、`出しっぱ・置きっぱ→Y03`、`机→Y04`、`返却・戻→Y05`、
  `電気・照明→Y06`、`空調・エアコン→Y07`、`冷蔵・冷凍→Y08`、`掃除・ほこり→Y09`、`補充・切れ・備品→Y10`です。
  複数に一致する場合は上記の順で選び、選んだキーが使用済み、または該当語がない場合は最小の空き番号を割り当てます。
  既存の雑務のキーは変更しません。
  無効にした雑務のキーも過去の妖怪のために保持します。空きがなければ全体を保存せず、入力者に理由を伝えます。
  10種類を超える新規割り当てが必要になったら、画像・キー一覧とSQLの割り当て範囲を合わせて拡張してください。
- 保存処理と`submit_report`は同じサーバー設定行をロックし、同時の設定変更・報告処理を順番に実行します。
- RPCはBotのサーバー側の`service_role`だけが実行できます。モーダル送信時にもDiscordのサーバー管理権限を確認します。

通知時刻はサーバー設定の`timezone`で解釈する時刻です。定期実行やDiscordへの投稿処理は別途必要です。
出現条件の変更は保存されますが、この保存関数は既存の妖怪の状態を書き換えたり、通知ジョブを発行したりしません。
現在の報告処理は次の報告時に新しい条件を使い、レベルも現在の条件で計算します。既存の妖怪のレベルを固定したい場合は別途ルール変更が必要です。

### コードからの呼び出し

```ts
import { saveBasicSettings, saveTaskSettings } from "../database/settings.js";

await saveBasicSettings(guildId, {
  notificationChannelId: "111111111111111111",
  adminChannelId: "222222222222222222",
  digestHour: 19,
  digestMinute: 30,
}, ["流し", "会議室"]);

await saveTaskSettings(guildId, 3, ["洗い物", "ごみ出し"]);
```

個別の変更用には`saveGuildSettings()`・`saveLocationNames()`・`saveTaskTypeNames()`も利用できます。
複数の変更をまとめて確定したい画面では、上の2つの関数を使ってください。

## いつもの仕事の記録

`task_types.task_kind`で、`abnormal`（あってはいけない状態）と`routine`（いつもの仕事）を区別します。
既存の雑務・設定画面から追加する雑務は、従来どおり`abnormal`になります。
設定画面の入力方法は未対応です。種類を指定する場合は、DBで対象の行を変更してください。
設定画面から一覧を再保存しても、既存の雑務の種類は維持します。

適用順は、**`sql/migrations/20261026_task_kind.sql` → `sql/functions/submit_report.sql` → Botの更新・再起動**です。
列追加SQLは`task_types`と`reports`へ`task_kind`を追加します。再実行しても指定済みの種類は初期化しません。
`reports.task_kind`は記録時の種類で、雑務の種類を後から変えた場合も過去の記録や再送の扱いを維持します。

たとえば、登録済みの雑務を「いつもの仕事」にする場合は、サーバー・名前を実際の値に置き換えて実行します。

```sql
begin;
-- 観測・設定保存と同じサーバー行で順番に処理する。
select 1 from public.guild_settings where guild_id = '対象のサーバーID' for update;
update public.task_types set task_kind = 'routine'
where guild_id = '対象のサーバーID' and name = 'ごみの回収';
commit;
```

- `routine`でも`/youkai`から記録でき、`reports`への保存と守り神ポイントの加算を同じトランザクションで行います。
- 同じ人・場所・雑務へのポイント加算は1時間に1回までです。同じ`request_id`の再送は記録もポイントも増やしません。
- 妖怪の作成・観測数の更新・観測に伴う通知ジョブの作成は行わず、本人には仕事の記録とポイントだけを返します。
- 既存の妖怪がある雑務を`routine`に変えても、その妖怪は削除・更新しません。最後の異常観測からの弱体化・成仏判定は継続します。
- 期間内の全記録数にはいつもの仕事も含めますが、妖怪ごとの期間内観測数には含めません。
- 雑務の追加時の妖怪キー割り当ては従来どおりです。種類変更でキーは解放しません。

## 未送信通知の定時配信

最初に`sql/migrations/20261024_notification_delivery.sql`をSupabaseのSQL Editorで実行し、
`guild_settings.timezone`（既定値`Asia/Tokyo`）、`notification_jobs.sent_at`、未送信検索用インデックスを追加します。
続けて`sql/functions/process_yokai_ascensions.sql`を実行し、成仏判定用のDB関数を追加します。
`sql/migrations/20261024_yokai_identity.sql`は`yokai_states`へ`yokai_name`と`image_key`を追加し、
既存の誕生済み妖怪を雑務名・現在レベルから補完します。その後、最新の`sql/functions/submit_report.sql`を適用してください。

Bot起動中は1分ごとに各Guildの設定を確認し、`notification_time`がそのGuildの`timezone`で
現在時刻と一致したとき、`notification_jobs.sent_at is null`の行をまとめて通知します。
`/summary`を使うと、同じ未送信行をその場で集計し、コマンドを使ったチャンネルへ全員に見える形で通知できます。
定時通知・`/summary`とも、通知ジョブを読む前に、`stage = active`かつ
`last_reported_at + guild_settings.jobutsu_days <= 現在時刻`の妖怪を成仏させます。
成仏への状態更新と`ascend`通知ジョブの登録はDB内の同じトランザクションで行います。
誕生・成仏の通知には、`yokai_states`に固定した名前と`src/assets`の画像をEmbedで表示します。
現時点の名前は初回誕生時に「雑務名＋の妖怪」で作り、画像は`task_types.yokai_key`と現在レベルから選びます。
正式名を別処理で決める場合は、同じ`yokai_name`・`image_key`を更新すれば通知側はその値を使います。
定時通知・手動通知とも、Discordへの送信成功後にだけ`sent_at`を更新します。送信失敗時は未送信のまま残り、定時通知は同じ時刻枠で再試行します。

- `presence`・`shadow`はプライバシー保護のため場所を表示せず、件数だけ通知する。
- `birth`・`level_up`・`weaken`・`ascend`も現在は件数で通知する。`birth`・`weaken`・`ascend` は妖怪の名前も出す。
- `weaken`（弱ってきた）は、`process_yokai_ascensions` が最後の報告から成仏日数の半分を過ぎた妖怪に1回だけ作る。同じ判定で成仏する妖怪には作らない。
- 未送信行が0件ならDiscordへ投稿しない。
- Botが通知時刻の1分間を通して停止していた場合、その日の通知は翌日の指定時刻まで待つ。
- 実DBへは、設定保存SQL、通知配信migration、PR #5のevent type migration、妖怪名・画像migration、成仏判定SQL、最新の報告関数の順で適用する。

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
設定については、RPCの内容、設定の再読み込み、管理者権限、保存成功・失敗時の画面も確認します。
`npm test`は実際のSupabaseへの接続や書き込みを行いません。

DB側の保存処理は、SQL Editorで`sql/functions/tests/save_guild_settings_test.sql`の全文を実行して確認できます。
このテストは使い捨てのサーバーIDで検証し、最後に`rollback`するのでテストデータを残しません。
初回保存・部分更新・無効化と再有効化・過去の報告の保持・サーバー分離・妖怪キー不足時のロールバック・実行権限を確認します。

観測処理は`sql/functions/tests/submit_report_test.sql`、いつもの仕事の分岐は
`sql/functions/tests/routine_report_test.sql`で確認できます。列追加SQLと最新の関数を先に適用してください。
いつもの仕事のテストは、妖怪・通知を作らないこと、ポイントの1時間制限、二重送信、種類変更後の再送と既存妖怪の保持を検証し、最後にロールバックします。
