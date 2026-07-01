# v450 Semantic Index cache hygiene

Semantic Indexの共有JSONは正本です。SQLite / sqlite-vec / FTS5 は端末ローカルの再構築可能な高速キャッシュとして扱います。

- 差分更新・全件更新の後、短い遅延でローカルSQLiteの保守確認を実行します。
- 削除済みItemに紐づくvec/FTSマップと、解消済みの失敗記録を除去します。
- 通常の自動保守は`VACUUM`しません。書込み・検索を不必要に止めないためです。
- 管理画面の「容量を整理」は、WAL checkpoint後に手動でVACUUMを実行します。共有JSONは変更しません。
- vec/FTSにマップがない孤立行が検出された場合は画面に表示され、手動整理または再Indexで復旧できます。
