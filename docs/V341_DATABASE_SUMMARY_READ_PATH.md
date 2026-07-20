# V341 Database Summary Read Path

## 目的
v340時点で残っていた DB JSON 全読込の一部経路を、SQLite の `database_summary_index` へ寄せる軽量化。

## 変更点
- Dashboard summary の DB 件数を `listDatabases()` ではなく `database_summary_index` の `COUNT(*)` から取得。
- 共有DB保存時の scope safety check で、Private DB ID を `database_summary_index` から取得。
- Private Page ID は `pages.properties_json` から軽量取得し、`listPages()` によるロック確認や全Page object化を避ける。
- `database_summary_index` が未構築の場合のみ、従来のフル読込へfallback。

## 期待効果
- Dashboard更新時のDB JSON読込削減。
- DB保存時の `enforceDatabaseScopeRules()` 軽量化。
- DB数が増えたVaultで共有フォルダI/Oを削減。

## 注意
`listDatabasesCore()` 自体は互換性のため完全DBオブジェクトを返す経路を維持。DB一覧UIのsummary化は、画面側の参照整理が必要なため別段階。
