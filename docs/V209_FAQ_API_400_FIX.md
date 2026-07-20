# v209 FAQ API 400 Fix

## 修正内容

- `/smart-assist/faqs/search-stats` が SQLite/FTS 初期化差分で 400 を返す問題を防止。
- `/smart-assist/faqs/query` が例外時に 400 を返して画面を止める問題を防止。
- Smart Assist FAQ 用 SQLite テーブルを `vaultService` 側でも自己修復作成するように変更。
- FAQ JSON取込時に `status` が無いレコードは `approved` として扱うように変更。
- `negativeTerms` をFAQ保存時に保持するように変更。

## 対応後の挙動

API内部で一時的なインデックス不整合が起きても、フロントには空リストまたは安全な統計JSONを返します。
そのため、ブラウザコンソールに `400 Bad Request` が出にくくなります。

## 推奨操作

1. アプリを起動
2. FAQ JSONを再取込
3. 運用パネルから「検索・意味ベクトル再生成」
4. 画面を再読み込み
