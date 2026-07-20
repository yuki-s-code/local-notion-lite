# V758 FitView Initialization Fix

## 修正内容

- `FreeformCanvasScreen.tsx` の `fitView` を、参照する `handleBoardImport` より前に定義するよう移動。
- React のレンダー中に依存配列 `[fitView, ...]` が評価された際、`const fitView` の初期化前領域（TDZ）へアクセスして画面が落ちる問題を解消。
- `fitView` の実装内容や挙動は変更せず、定義順だけを安全な順序へ整理。
- 同ファイル内の Hook 依存配列について、後方定義されたローカル変数を参照する同種の初期化前アクセスを機械確認。

## 確認

- `fitView` 定義行が `handleBoardImport` より前にあることを確認。
- CSS構造チェック成功。
