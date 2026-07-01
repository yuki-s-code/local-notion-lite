# v148 FAQ Search Engine

## 目的

FAQが数千件規模になっても、右サイドバーのFAQライブラリとLocal Generative AssistのFAQ検索が重くなりにくいように、共有JSONを正本として維持しつつ、検索用にSQLite/FTSインデックスを追加しました。

## 追加内容

- `smart_faq_index` テーブルを追加
- `smart_faq_fts` FTS5仮想テーブルを追加
- `/smart-assist/faqs/query` を追加
- `/smart-assist/faqs/search-stats` を追加
- `/smart-assist/faqs/reindex` を追加
- FAQ保存時に検索インデックスを自動再構築
- FAQライブラリに検索エンジン状態カードを追加
- 検索結果に理由チップを表示

## 設計

FAQ本体は引き続き共有フォルダの `smart-assist/faq-items.json` に保存します。SQLiteは検索・絞り込み・大量件数表示を速くするためのインデックスです。

```txt
faq-items.json = 正本・共有・バックアップしやすい
SQLite FTS     = 検索・絞り込み・大量FAQ対応
```

## 運用目安

- 数百件: これまでどおり快適
- 数千件: SQLite FAQ Search Engine推奨
- 1万件以上: ページング/カテゴリ分割/検索中心運用推奨

## 注意

SQLiteインデックスが壊れても、FAQ本体はJSONに残ります。画面の「再インデックス」で再構築できます。
