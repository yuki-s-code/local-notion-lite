# V617 タスク管理パック・Rollup整合性改善

## 修正
- タスク管理パックの親子Relationを、`Parent Task`（サブアイテム親ポインタ）と `Child Tasks`（逆方向Relation）の対に変更。
- 親行のRollupは `Child Tasks` を対象にするため、子タスク数・完了数・進捗率が親行で正しく算出される。
- 完了判定は `Status` の `完了` / `完了済み` / `Done` / `Completed` に統一。
- Status用Rollup関数 `count_status_done` / `count_status_open` / `percent_status_done` を追加。
- 表示、AI/検索向け計算、Semantic Index用のRollup表示で同じ完了判定を使用。

## 効率性
- Rollupは既存Relationに含まれるIDだけを参照し、親行ごとの全DB走査を新たに追加しない。
- Relationの逆方向同期は既存PATCH経路でまとめて保存され、複数の子を関連付けても1回の保存・Index更新に集約される。
- サブアイテムを有効化したDBは既存どおりClient階層表示を使用する。大規模DBのサーバー階層ページングは別途の構造改善課題。

## 再実行時の安全性
- 同じ名前・型の既存プロパティを再利用し、不足分だけを追加する。
- `Gantt Pro` は同名ビューが存在する場合に追加しない。
- 新設したStatus列の初期値だけを `未着手` にし、既存行・既存Statusの値は変更しない。
