# V743 Freeform Foundation Fix

## 修正内容

- フリーボードの初期データを1回だけ読み込み、表示StateとUndo履歴の初期スナップショットを統一。
- Undo/RedoのインデックスをRefでも管理し、連続操作時の古いクロージャ参照を解消。
- ドラッグ中は一時更新、Pointer Up時に1回だけ履歴へ確定する方式へ変更。
- 複数選択したカードをまとめて移動可能に変更。
- ノードごとの実寸を使用してキャンバス端へのはみ出しを防止。
- テキスト、色、画像位置、拡大率などの連続編集を500ms単位で1履歴へまとめる方式へ変更。
- 全消去をUndo可能な操作へ変更。
- 空白ダブルクリックは選択ツール時のテキスト追加だけに限定し、単クリックとの多重追加を解消。
- 画像本体をlocalStorageへBase64保存せず、IndexedDBの専用asset storeへ保存。
- 旧Data URL画像は読み込み時にIndexedDBへ自動移行。
- 保存領域不足などのlocalStorage保存失敗を捕捉し、ユーザーへ通知。
- 消しゴム判定を描画ノードの外接矩形判定から、実際の線分との距離判定へ変更。

## 新規ファイル

- `src/renderer/src/lib/freeformPersistence.ts`
  - IndexedDB画像保存
  - 画像取得
  - 画像削除用API
  - 旧Data URL変換

## 互換性

- 従来の `local-notion:freeform-canvas-v735` と `v733` のボードデータを読み込み可能。
- 旧Base64画像は初回表示時に新asset形式へ移行。
- ボードの型バージョンは今回変更していないため、既存キャンバスをそのまま利用可能。

## 検証

- `FreeformCanvasScreen.tsx` をesbuildでTSX構文検証済み。
- `freeformPersistence.ts` をesbuildでTypeScript構文検証済み。
