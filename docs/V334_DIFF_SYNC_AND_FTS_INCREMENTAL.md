# V334 起動時差分同期・FTS差分更新

## 目的

会社端末・共有フォルダ運用で重くなりやすい以下の処理を軽量化する。

- 起動時の共有フォルダ全ページ読み直し
- `importFromShared()` 後の `rebuildFts()` 全件再構築
- ページ保存・作成・復元・削除時の `page_fts` 全件再構築

## 変更内容

### 1. 共有フォルダページの差分検知

`shared_page_file_state` テーブルを追加した。

対象ファイルの `mtimeMs` と `size` から署名を作り、前回と同じ場合はページ本文・BlockSuite JSONの再読込をスキップする。

対象ファイル:

- `meta.json`
- `content.md`
- `blocksuite.json`

変更なしのページは、ローカルSQLite上の既存 `pages` / `page_fts` / `page_search_index` をそのまま使う。

### 2. FTS差分更新

`rebuildFts()` の全件再構築に依存しないよう、以下を追加した。

- `upsertPageFts(db, page)`
- `deletePageFts(db, pageId)`

ページ作成・保存・復元・タスク更新・親子関係変更では該当ページだけ `page_fts` を更新する。

ページのゴミ箱移動・完全削除では該当ページだけ `page_fts` から削除する。

### 3. importFromSharedの変更

`importFromShared()` は、変更があるページだけを読み込み、該当ページだけ以下を更新する。

- `pages`
- `page_fts`
- `page_search_index`
- `workspace_link_index`
- `broken_link_index`
- `shared_page_file_state`

全ページの `rebuildFts()` は実行しない。

## 効果

変更がない起動時は、共有フォルダ上の大量の `content.md` / `blocksuite.json` を読み直さずに済む。

1ページだけ変更された場合は、そのページだけを読み込み、FTSと派生Indexもそのページ分だけ更新する。

## 注意

- 初回起動やキャッシュ未作成時は従来通り一度読み込む。
- ファイル署名は `mtimeMs:size` ベース。共有フォルダの仕様でmtimeが不安定な場合は再読込が多くなる可能性があるが、データ欠落より安全側に倒す。
- `rebuildFts()` は残している。キャッシュ破損時や将来のメンテナンス用途で全件再構築が必要な場合に使える。
