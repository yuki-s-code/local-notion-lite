# v627 分析関数のDuckDBオフロード監査

## 変更

分析関数セルのうち、結果全件をRendererへ取得していた次の処理をDuckDB側で実行するようにした。

- 2結果のleft / inner join
- unpivot
- splitText
- dateDiff
- dropDuplicates
- renameColumn
- conditionalColumn
- 安全なFormulaプリセット（四則演算、丸め、絶対値、年月、空欄補完、日数差、しきい値判定）

## 効率性

上流セルが`resultId`を持つ場合、分析サービスの一時結果キャッシュからDuckDBの一時表へ直接投入する。Rendererは先頭ページだけを受け取るため、大きな結合や縦持ち変換で全件配列を生成しない。

統計検定、移動平均、順位、相関・回帰、複雑な時系列処理は結果の互換性を優先し、既存のRenderer処理を維持した。

## 安全性

- SQL識別子・文字列は既存のquote helperを使用
- 結合は既存仕様どおりleft / innerのみ
- SQL化できない設定は従来の関数実装へフォールバック
- Named Resultの上限、クエリ上限、結果キャッシュTTLは既存設定のまま
