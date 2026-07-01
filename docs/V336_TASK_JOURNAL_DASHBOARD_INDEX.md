# V336 Task / Journal / Dashboard Index

## 目的
会社端末で重くなりやすい Tasks / Journal / Dashboard の全件走査を減らし、SQLiteサマリーインデックスから高速表示できるようにする。

## 追加テーブル
- `task_index`
  - ページ / Journal / Inbox のチェックボックス行を抽出して保存
- `journal_summary_index`
  - Journal一覧に必要な日付・タイトル・プレビュー・タグ等を保存
- `workspace_summary_cache`
  - Dashboard用の集計・最近項目をJSONキャッシュとして保存

## 主な変更
- `listTasks()` は `task_index` を優先参照
- `listJournals()` は `journal_summary_index` を優先参照
- `getWorkspaceDashboard()` は `workspace_summary_cache` を優先参照
- ページ保存時は該当ページのtask indexも更新
- Journal保存時はJournal summaryとtask indexを更新
- Inbox作成/更新/削除時はtask indexを更新
- Smart Assist設定画面に確認/再構築ボタンを追加

## 運用
インデックスが古い・空の場合は、Smart Assist設定画面の「Task・Journal Index再構築」を実行する。

## 注意
これは正本ではなく表示高速化用のSQLite派生キャッシュ。壊れても共有フォルダの正本データから再構築できる。
