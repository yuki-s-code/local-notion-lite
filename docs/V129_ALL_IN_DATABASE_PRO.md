# v129 All-in Database Pro

v129 は v128 の自動保存DBを土台に、Notion級DBに近づけるための安全機能と実用機能をまとめて追加した版です。

## 追加内容

- Undo / Redo
  - DB編集の直近履歴を保持
  - 誤操作後に戻せるようにしました

- DBゴミ箱
  - 行・プロパティ・ビューを削除しても即完全削除せず、復元可能にしました
  - 完全削除は「DBゴミ箱を空にする」から行います

- 削除安全確認
  - Relation / Rollup / View から参照されるプロパティを削除する時に警告します

- DBテンプレート
  - 選択中の行からテンプレートを作成
  - テンプレートから新規行を追加可能

- Task Pro Pack
  - Done / Start / End / Parent Task / Depends On / Rollup / Formula / Gantt Pro View をまとめて追加
  - タスク管理・案件管理をすぐ始められる構成です

- 高度フィルター
  - 含まない / 始まる / 終わる / より大きい / より小さい / 日付条件 / 今日 / 今週 / 今月 / 期限切れ
  - Rollup / Formula の計算結果も検索・ソート・フィルター対象にしました

- Dashboard
  - 行数、入力率、期限切れ、Relation数、未入力が多い列を確認できます

- JSONバックアップ / 復元
  - DB単位でJSONを書き出し、同じDBに復元できます

- 整合性チェック
  - 壊れたRelation
  - 存在しないView参照
  - 壊れたRollup参照
  を検出します

## 方針

v129 は大きな機能追加ですが、既存DB構造を壊しにくいように、既存の `WorkspaceDatabase` JSONに optional field を追加する形にしています。

追加フィールド:

- `templates`
- `trash`
- `views[].collapsedGroupIds`

古いDB JSONでもそのまま読み込めるように、server側 normalizeDatabase で後方互換を維持しています。
