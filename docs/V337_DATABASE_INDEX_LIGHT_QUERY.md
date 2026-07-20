# v337 Database Index Light Query

## 目的

v336 時点で残っていたデータベース周りの重い経路を安全に軽量化する。

確認できた主な課題:

- `listDatabasesCore()` は DB JSON を読み込む。
- `queryDatabaseRowsCore()` は検索・ページングの前に `getDatabase()` で DB JSON 全体を読み、全行 `Map` を作っていた。
- `getDatabasePerformanceCore()` も行数確認のために DB JSON 全体を読んでいた。

## 追加内容

- `database_summary_index` テーブルを追加。
- DB保存時に DBメタ情報をSQLiteへ保存。
- DB行Indexに保存済みの `cells_json` から、単純ページング・検索結果を直接返す軽量経路を追加。
- `queryDatabaseRowsCore()` で、フィルタ/ソートなし・検索ありの場合はDB JSON全体を読まずにSQLiteから返す。
- `getDatabasePerformanceCore()` は `database_summary_index` を優先参照。

## 対象

高速化対象:

- 大量DBの通常ページング
- 大量DBのテキスト検索
- DB performance情報

現時点でJSON fallbackを残す対象:

- 複雑なfilter
- 複雑なsort
- Relation/Rollup/Formulaを含む構造化条件

これらは次段階でSQLite filter/sort indexへ移す。

## 注意

`listDatabasesCore()` はUI互換性のため、現時点では完全なDBオブジェクトを返す。`databases` state が行データを前提にしている箇所があるため、一覧APIをいきなりsummary化しない。

次段階では、UI側の用途を分けて `listDatabaseSummaries()` へ移すのが安全。
