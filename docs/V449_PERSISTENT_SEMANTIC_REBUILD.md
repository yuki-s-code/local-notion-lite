# v449 — 永続バックグラウンドSemantic Index再生成

- バックグラウンド再生成は8件前後のEmbedding単位でIndexを安全にコミットする。
- ジョブ状態は、利用者が指定した端末ローカルのSQLiteキャッシュ保存先に `workspace-semantic-rebuild-job.json` として保存する。
- アプリ終了後は状態を `interrupted` として復元する。管理画面の「前回の続きから再開」は、既にコミット済みのEmbeddingを再利用して未処理分のみ続行する。
- 共有フォルダにはジョブ状態を保存しない。共有JSONとSemantic Indexは従来どおり正本である。
- 中止時にも、最後に完了したバッチのIndexは検索に使い続けられる。
