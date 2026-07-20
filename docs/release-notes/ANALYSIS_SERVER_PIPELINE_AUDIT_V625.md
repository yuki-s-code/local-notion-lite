# 分析ノートブック：DuckDB側パイプライン移行（v625）

## 目的

分析セルのDataFrame・ピボット・統計処理で、上流結果を `/analysis/results/:id/all` からRendererへ全件取得し、ブラウザ側で再計算していた経路を段階的に縮小する。

## 実装

`AnalysisNotebookScreen.tsx` に、1つの上流結果を一時テーブルとしてDuckDBに渡すSQLビルダーを追加した。

- DataFrame: `filter` / `select` / `sort` / `limit`
- Pivot: 列方向のクロスタブを使わない `count` / `sum` / `average`
- Summary: 数値列が明示指定されている場合の件数、欠損数、平均、中央値、最小、最大、標準偏差、ユニーク数

上流結果に `resultId` がある場合、サーバーの一時結果キャッシュから全行を直接利用する。Rendererには処理後の先頭ページだけが戻る。

## 互換性優先で従来経路を維持した対象

以下は仕様差を避けるため、従来どおり必要時だけ全件取得してRendererで処理する。

- 列値を動的に展開するクロスタブPivot
- 数値列を自動推定する既存Summary
- 分析関数セル
- 品質チェック
- 前処理セル
- 取込結果に `resultId` が無い場合

## 性能上の効果

SQL結果が10万行の場合でも、上記のサーバー対応セルでは、DataFrame処理のために10万行をIPC/HTTPでRendererへ複製しない。既存の結果キャッシュ、500行のページ応答、表の仮想スクロールをそのまま利用する。

## 検証

- `AnalysisNotebookScreen.tsx` を esbuild でTSX変換し、構文変換に成功。
- 依存関係がZIPに含まれないため、プロジェクト全体の `npm run typecheck` は実行していない。
