# V335 Fast Boot and Lock Index

## 目的
会社端末・共有フォルダ運用で起動直後の待ち時間を減らすため、API起動時に共有フォルダ同期を待たず、ローカルSQLiteキャッシュから先に画面を返す。

## 変更内容

- API起動時の `await vault.importFromShared()` を廃止
- `vault.startBackgroundImportFromShared('startup-fast-boot')` を追加
- `/health` に共有フォルダ同期状態 `sync` を追加
- `/sync/status` を追加
- 手動同期 `/sync/import` は `runImportFromShared('manual-sync')` を待つ
- `listPages({ includeLocks?: boolean })` を追加
- 一覧用ロック確認をページごとの `pathExists` から `locks` ディレクトリ一括読込へ変更
- `listPageTree()` と `getWorkspaceDashboard()` はロック確認を省略して軽量化
- ページを開く時・編集ロック取得時は従来どおり対象ページのlockを正確に確認

## 期待される効果

- 起動時にAPIが早く立ち上がる
- サイドバー/初期画面がローカルSQLiteキャッシュから先に出る
- 共有フォルダ差分同期はバックグラウンドで実行される
- ページ数が多いVaultで `listPages()` のロック確認が軽くなる

## 注意

初回起動・キャッシュ未作成時は、バックグラウンド同期完了後に最新状態へ追いつく。手動で確実に同期したい場合は既存の同期ボタンを使う。
