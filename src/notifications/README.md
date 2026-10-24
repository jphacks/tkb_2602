# notifications/（4番：表示・通知）

- 妖怪・守り神の表示（Embed）と、毎日18時のまとめ通知の見た目を作る関数を置く
- 報告者の名前や ID は、どの表示にも絶対に入れない

定期報告のデータ取得は`../database/periodic-reports.js`の`getPeriodicReport()`を使います。
呼び出し例と返り値は[DB操作の説明](../database/README.md)を参照してください。
