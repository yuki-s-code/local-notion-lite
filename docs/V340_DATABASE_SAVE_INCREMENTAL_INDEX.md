# V340 Database Save Incremental Index

## 目的

v339 ではDB行の読み込み・検索・filter/sort用Indexは整備されたが、DB保存時に `rebuildDatabaseRowIndex(database)` が毎回全行を削除・再挿入していた。

v340 では、通常保存時は差分更新を優先し、1セル編集・1行追加・行順変更でDB全体を再Index化しないようにした。

## 追加テーブル

- `database_row_hash_index`
  - DB行ごとの `row_hash` と `row_order` を保存
- `database_index_state`
  - DBごとの `schema_hash` / `row_count` / `indexed_at` / `mode` を保存

## 動作

### 通常保存

`saveDatabaseFile()` は以下を実行する。

1. DB JSONを保存
2. `database_summary_index` を更新
3. `upsertDatabaseRowIndexIncremental(database)` を実行

差分更新では以下を判定する。

- 新規行: その行だけinsert
- 変更行: その行だけdelete + insert
- 削除行: その行だけdelete
- 行順変更のみ: `row_order` だけupdate
- プロパティ構成変更: 安全のため全再構築
- 既存Index不整合: 安全のため全再構築

### 手動再構築

`Database Index再構築` は従来どおり全再構築を行う。

## 期待効果

- 大量DBでのセル編集後の保存待ちを軽減
- 行追加/削除時のIndex更新負荷を軽減
- 行順変更時の再Index化を回避

## 注意

SQLite Indexは正本ではなくキャッシュ。壊れた場合は管理画面から `Database Index再構築` を実行する。
