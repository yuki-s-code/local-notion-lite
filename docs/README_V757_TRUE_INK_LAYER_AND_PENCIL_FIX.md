# V757 True Ink Layer / Pencil Fix

## 修正
- 描画中の SVG `<path>` に `fill="none"` を明示。
- 古い `.freeform-live-stroke polyline` CSS を現在の `<path>` に合わせて修正。
- 保存済み描画を通常カード DOM から分離し、専用 SVG インクレイヤーで描画。
- 描画ノードの透明な矩形、backdrop-filter、カード背景が下の要素へ影響しない構造へ変更。
- 選択表示は矩形ではなく線に沿った半透明ハイライトへ変更。
- 線の部分だけがポインター対象となり、円の内側の空白では下の要素を操作可能。
- 描画点を保存時に間引き、JSONサイズと描画負荷を削減。
- 線幅に応じた余白で太い線の端が欠けないよう修正。
- 描画レイヤー上のイベント伝播を整理し、範囲選択との競合を防止。

## 検証
- FreeformCanvasScreen.tsx 構文変換成功
- freeformCanvasModel.ts 構文変換成功
- CSS braces 整合
