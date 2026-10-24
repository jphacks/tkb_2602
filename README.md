# 妖怪だより

<p align="center">
  <img src="src/assets/cover.jpg" alt="妖怪だより" width="360">
</p>

<p align="center"><strong>その「困った」は、妖怪のしわざ。</strong></p>

研究室の「名もなき雑務」を、誰かの失敗ではなく **妖怪という共通の問題** に変える Discord Bot です。気づいた人が選択式で記録し、同じ問題が繰り返されると妖怪が出現・成長します。問題が起きなくなると妖怪は成仏します。

## 解決したいこと

研究室には、流しの洗い物、あふれたゴミ箱、つけっぱなしの電気など、担当者のいない雑務があります。気づいた人が黙って片づけ続ける一方で、直接注意すると「誰が残したのか」という責任追及になりやすく、問題を共有しづらいのが課題です。

妖怪だよりは、**誰も名指しせず、繰り返し起きている問題だけを可視化する** ことで、研究室全体が仕組みの改善を話し合える状態をつくります。

## 体験の流れ

1. やり残されたことを片づけた人が `/youkai` を実行し、「場所」と「やり残されていたこと」を選びます。
2. 同じ場所 × 雑務の記録が増えると、「気配」→「影」→「出現」と変化します。出現後は記録数に応じてレベルと姿が変わります。
3. 全体チャンネルには、指定時刻に未通知の変化をまとめた「妖怪だより」が届きます。
4. 最後の記録から一定日数が経過すると、妖怪は成仏します。
5. 片づけを記録した本人には守り神ポイントがたまり、守り神が成長します。

## 主な機能

| コマンド | 公開範囲 | 内容 |
| --- | --- | --- |
| `/youkai` | 操作結果は本人のみ | 場所と雑務を選び、妖怪を観測する。任意のひとことは管理者だけに届く |
| `/now` | チャンネル全体 | 場所ごとに、現在活動中の妖怪・雑務・レベルを表示する |
| `/summary` | チャンネル全体 | 成仏判定後、未送信の妖怪の変化をその場でまとめて通知する |
| `/mamorigami` | 本人のみ | 自分の守り神、ポイント、レベルを確認する |
| `/youkai-junbi` | 管理者のみ | 初回用チャンネルと場所・雑務の初期一覧を自動作成する |
| `/youkai-settei` | 管理者のみ | 通知先、通知時刻、出現回数、場所・雑務の一覧を設定する |
| `/demo` | 管理者のみ | 発表用に時間を進める、妖怪だよりを送る、データをリセットする |

### 妖怪のライフサイクル

```text
presence（気配） → shadow（影） → active（出現・成長） → ascended（成仏）
```

- 出現回数はサーバーごとに設定できます。
- 出現後のレベルは `報告数 - 出現に必要な報告数 + 1` で計算します。
- Lv.1 / 5 / 10 / 25 で表示画像が変わります。
- 成仏判定は、定時通知または `/summary` の直前に行います。

## プライバシー設計

「名前を出さないように気をつける」のではなく、名前が公開されにくいデータ構造と通知方式にしています。

| 守ること | 実装 |
| --- | --- |
| 誰が記録したかを残さない | `reports` に報告者の列を持たせない |
| 守り神の集計と匿名性を両立する | Discord ID は保存せず、秘密値を鍵に HMAC-SHA256 で生成した仮名識別子 `member_key` だけを使用する |
| 通知時刻から報告者を推測させない | 記録直後に全体通知せず、指定時刻のダイジェストにまとめる |
| 自由記述から個人を特定させない | ひとことは管理者チャンネルだけに匿名で送り、DBには保存しない |
| 公開メッセージを制御する | 場所・雑務は管理者が登録した選択肢を使い、メンションを無効化する |
| 初期段階の問題を晒さない | `presence` と `shadow` は本人への応答だけで扱う |

## 守り神

片づけの記録を続ける動機を、他人との競争ではなく「自分だけに見える成長」に変える仕組みです。

- 1回の有効な記録につき1ポイント
- 同じ人 × 場所 × 雑務では1時間に1回まで加算
- 初回に守り神を選択し、Lv.1 / 10 / 30 / 60 / 100 で姿が変化
- ポイントや守り神は `/mamorigami` を実行した本人だけに表示

## 技術構成

```text
Discord
  └─ Slash Commands / Modal / Select Menu
          │
          ▼
Node.js + TypeScript + discord.js
          │
          ▼
Supabase（PostgreSQL / RPC）
  ├─ reports            匿名の観測記録
  ├─ yokai_states       妖怪の現在状態
  ├─ notification_jobs  未送信の通知イベント
  ├─ guardian_points    守り神ポイント
  └─ guardian_cooldowns 重複加算の抑制
```

記録、妖怪状態の更新、通知ジョブの作成、守り神ポイントの加算は、`submit_report` RPC の1トランザクションで処理します。通知はDiscordへの送信が成功した後にだけ `sent_at` を更新するため、失敗した通知を再試行できます。

## セットアップ

### 必要なもの

- Node.js
- Discord Bot（トークン、Application ID、テスト用Guild ID）
- Supabaseプロジェクト（URL、Secret key）

### 1. インストール

```bash
git clone git@github-other:jphacks/tkb_2602.git
cd tkb_2602
npm install
cp .env.example .env.local
```

`.env.local` に次を設定します。

```dotenv
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
MEMBER_KEY_SECRET=
```

`MEMBER_KEY_SECRET` は同じ値を使い続けてください。変更すると、同じ利用者でも守り神ポイント上は別人として扱われます。

### 2. SupabaseへSQLを適用

Supabaseの SQL Editor で、対象環境の既存スキーマに対して次の順に実行します。

1. `sql/functions/save_guild_settings.sql`
2. `sql/migrations/20261024_notification_delivery.sql`
3. `sql/migrations/20261024_notification_jobs_presence_shadow.sql`
4. `sql/migrations/20261024_yokai_identity.sql`
5. `sql/migrations/20261024_guardians.sql`
6. `sql/migrations/20261024_demo_time_offset.sql`
7. `sql/functions/process_yokai_ascensions.sql`
8. `sql/functions/reset_demo_data.sql`
9. `sql/functions/submit_report.sql`

詳細とDB単体テストは [src/database/README.md](src/database/README.md) を参照してください。

### 3. Discordコマンドを登録して起動

```bash
npm run deploy
npm start
```

Botがオンラインになったら、管理権限を持つユーザーが `/youkai-junbi` を実行します。通知時刻は30分単位で設定できます。

## 開発

```bash
npm run typecheck
npm test
```

主な実装箇所：

- [src/commands/](src/commands/) — Discordコマンド
- [src/notifications/digest.ts](src/notifications/digest.ts) — 定時・手動の妖怪だより
- [src/database/](src/database/) — Supabaseとの読み書き
- [sql/functions/](sql/functions/) — トランザクション処理
- [sql/migrations/](sql/migrations/) — DB差分
- [src/assets/](src/assets/) — 妖怪・守り神の画像

## ハッカソンで注力した点

- **責任追及を生まない判断軸**：担当者や期日を置かず、「誰かを名指しする道を作らないか」で機能を選びました。
- **時刻を切り離した通知**：観測と全体通知を分離し、通知時刻から報告者を推測しづらくしました。
- **再現可能な状態遷移**：妖怪の出現・成長・成仏と通知予定をDB側で一貫して更新します。
- **Discord内で完結**：新しいアプリを導入せず、選択式の操作と管理画面をDiscord上に実装しました。
- **105枚のビジュアル**：妖怪40枚、成仏40枚、守り神25枚を状態・レベルに応じて出し分けます。

## 今後の展望

- 成仏前の「弱ってきた」状態を妖怪だよりで知らせる
- 出会った妖怪と個体の経歴を振り返れる妖怪図鑑
- 研究室ごとの新しい雑務と妖怪ビジュアルを追加できる仕組み
- 活動傾向を個人ではなく場所・雑務単位で振り返るダッシュボード

## 使用技術

- TypeScript / Node.js
- discord.js v14
- Supabase（PostgreSQL / RPC）
- Node.js `crypto`（HMAC-SHA256）
- Node.js Test Runner

## 素材について

妖怪・守り神の画像はHack Day前に生成AIで作成した素材です。発生時は `src/assets/birth`、成仏時は `src/assets/ascend` の同名画像を使用します。
