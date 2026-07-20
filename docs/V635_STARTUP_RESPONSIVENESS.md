# V635 起動応答性の改善

## 変更

- BrowserWindow をローカルAPIの起動完了より先に表示するよう変更しました。
- SQLiteのオープン・マイグレーションと共有フォルダ初期化は、初回画面描画後に開始します。
- 共有フォルダのディレクトリ初期化を逐次実行から `Promise.all` に変更しました。SMB共有では往復待機を大きく減らせます。
- `openLocalDb`、`initVault`、ルート登録、ローカルAPI全体の区間時間を Electron コンソールへ `[startup]` ログとして出力します。
- 起動直後に終了された場合も、遅延中のAPI起動が残したSQLiteハンドルを閉じるよう終了処理を調整しました。

## 想定される挙動

共有フォルダが遅い場合でも、最初に「起動中…」の画面が表示されます。その後API準備が終わると、ローカルSQLiteキャッシュを使ってワークスペースを開き、共有フォルダ同期は既存のアイドル時処理で続行します。

## 計測の見方

設定画面の「共有フォルダ」カードにも、SQLite・共有フォルダ初期化・API全体の起動時間を表示します。


開発者コンソールまたはアプリ起動ログで以下を確認してください。

- `[startup] renderer-first-load`
- `[startup] local-api-ready { openLocalDbMs, initVaultMs, routeRegistrationMs, totalMs }`

`initVaultMs` が長い場合は共有フォルダ、`openLocalDbMs` が長い場合はSQLite保存先またはDBマイグレーションがボトルネックです。
