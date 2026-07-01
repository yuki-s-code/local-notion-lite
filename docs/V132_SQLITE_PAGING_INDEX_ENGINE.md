# v132 SQLite Paging / Index Engine

v132では、大量件数のデータベースを本格運用できるように、JSON保存を維持しながらSQLite側に検索・ページング用の行インデックスを追加した。

## 追加したもの

- `database_row_index`
  - database_id / row_id / row_order / title_text / search_text / cells_json / created_at / updated_at
  - DB行をページ単位で取得するための軽量インデックス
- `database_row_fts`
  - 将来のランキング検索・全文検索拡張用FTS5テーブル
- `database_index_meta`
  - indexed_at / row_count を保持
- API
  - `GET /databases/:id/query`
  - `GET /databases/:id/performance`
  - `POST /databases/:id/reindex`

## 方針

従来のDB本体は `databases/*.json` に残す。これにより、共有フォルダでの可搬性とバックアップしやすさを維持する。
一方で、大量行の検索・一覧取得・ページングはSQLiteインデックスを使えるようにした。

## 現在の使い分け

- 〜2,000行: 従来のJSON + React表示で運用可能
- 2,000〜10,000行: Large DB Mode + SQLiteインデックス推奨
- 10,000行以上: `GET /databases/:id/query` を中心にページ取得へ移行推奨

## UI追加

Large DB Mode時に `SQLite Server Engine` の状態カードを表示する。

- indexedRowCount / rowCount
- Reindexボタン
- 推奨モード normal / large / server

## 注意

v132では既存UIとの互換性を優先し、すべてのDB表示を完全なサーバーサイドページングには置き換えていない。
次の段階では、Tableビューを `queryDatabaseRows` でページ単位取得する専用モードに移行できる。
