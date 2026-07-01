# v319 Ruri-v3 Local SQLite Cache / Semantic Index差分更新

## 目的

検索AI（Ruri-v3 / Transformers.js）の体感速度と共有フォルダ運用時の安定性を上げるため、共有フォルダ上のJSONを正本にしたまま、各PCが指定したローカルフォルダにSQLiteキャッシュを持てるようにした。

## 追加内容

- 検索AI設定に「ローカルSQLiteキャッシュ保存先」を追加
- ユーザーがフォルダ選択ダイアログでキャッシュ保存先を指定可能
- `smart-assist-semantic-cache.sqlite` を指定フォルダに作成
- `semantic_items` テーブルにFAQごとのsemantic embeddingを保存
- FAQ内容のhashを比較し、変更がないFAQはembeddingを再利用
- 削除済みFAQはSQLite semantic indexから削除
- `query_cache` テーブルを追加し、同一FAQ index hash + 同一質問の検索結果を再利用
- FAQ index hashが変わった場合、古いquery cacheを自動無効化
- 管理画面にキャッシュ状態表示を追加
  - Semantic件数
  - expected FAQ件数
  - query cache件数
  - 更新必要有無
  - SQLite DBパス
- 検索結果キャッシュ削除ボタンを追加

## 運用方針

- 正本: `smart-assist/faq-items.json`
- 高速キャッシュ: ユーザー指定フォルダの `smart-assist-semantic-cache.sqlite`

SQLiteキャッシュは壊れても削除して再構築できる。正本にはしない。

## 推奨保存先

会社PCでCドライブ書き込み制限がある場合は、書き込み可能なローカルフォルダを指定する。
共有フォルダに置く場合は、PCごとに別フォルダを指定すること。

例:

- `/Users/name/LocalNotionCache`
- `D:\LocalNotionCache`
- `共有フォルダ/.local-cache/PC名`

## 注意

依存関係がない環境では完全なtypecheckは実行できない。ローカルでは `npm install` 後に `npm run typecheck` を実行すること。
