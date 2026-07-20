# v576 — 分析ノートブックの条件セルとグラフ設定保存

## 追加内容

- ノートブックへ **条件セル** を追加。
  - テキスト、数値、日付、選択肢を設定できる。
  - SQLでは `{{parameter_name}}` で参照する。
  - 例：`WHERE updated_at >= {{start_date}}`
- 条件値はサーバーでSQLリテラルとして安全に変換する。
  - 任意SQLを値として実行しない。
  - 未定義パラメータ・数値形式不正・日付形式不正は実行前にエラー。
- 同じSQL名の条件セルは、実行前に画面で検出する。
- SQLセルのグラフ種別・横軸・縦軸は既存どおりノート保存時に保持されることをUIで明示。
- v575以前のSQL／メモセルだけのノートはそのまま開ける。

## 保存場所

- 分析ノート（条件セル・SQL・グラフ設定）：`local.sqlite`
- 分析データキャッシュ：`analysis.duckdb`
- 共有フォルダの正本データは変更しない。

## 例

条件セル：

- SQL名：`start_date`
- 種類：日付
- 値：`2026-04-01`

SQL：

```sql
SELECT date, title
FROM journals
WHERE date >= {{start_date}}
ORDER BY date DESC;
```
