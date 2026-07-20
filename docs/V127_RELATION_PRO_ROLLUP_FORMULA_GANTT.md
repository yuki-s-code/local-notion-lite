# v127 Relation Pro / Rollup / Formula / Gantt

## 目的
v126で追加したRelationの移動・逆引き機能を土台に、Notion級DBに近づけるための中核機能を追加した。

## 追加内容

### 1. Relation Pro
- 同じDB内のRelation列に「双方向Relation」を設定可能。
- 片側のRelationセルを更新すると、逆側Relationにも自動反映。
- Cross DB Relationは既存の逆引きRelationで参照できる。

### 2. Rollup
- Rollupプロパティ型を追加。
- Relation列を指定し、Relation先の行を集計できる。
- 集計方式：件数、チェック済み数、未チェック数、チェック率、合計、平均、最小、最大、重複なし一覧。

### 3. Formula
- Formulaプロパティ型を追加。
- 対応式：
  - `daysUntil(Date)`
  - `progress(完了数, 全体数)`
  - `{数値1} + {数値2}` のような数値演算
- 安全のため、任意JavaScript実行ではなく数値式に制限。

### 4. Gantt View
- Ganttビューを追加。
- Date列を開始日として表示。
- 終了日列がある場合は期間バーとして表示。
- タスク・案件・進捗管理向け。

## 推奨DB構成例

### 案件DB
- Name: Text
- Status: Select
- Start: Date
- End: Date
- 関連タスク: Relation → タスクDB
- タスク数: Rollup → 関連タスク / 件数
- 完了率: Rollup → 関連タスク / 完了チェック / チェック率

### タスクDB
- Name: Text
- Done: Checkbox
- Due: Date
- 関連案件: Relation → 案件DB
- 残日数: Formula → `daysUntil(Due)`

## 注意
- 同じDB内の双方向Relationは自動同期する。
- 他DBとの双方向同期は、現段階では逆引きRelation表示で確認する方式。
