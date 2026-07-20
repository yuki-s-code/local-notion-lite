# v736 BlockSuite Whiteboard Toolbar Fix

## 目的
- v735 のガラス風ツールバーがキャンバス幅からはみ出す問題を修正。
- ホワイトボードをさらに BlockSuite / AFFiNE 風の操作体験に寄せる。

## 主な変更
- ツールバーを `fit-content + max-width + overflow-x:auto` に変更し、狭い画面でもはみ出さないように調整。
- 操作ツール、作成ツール、ズーム操作をグルーピング。
- `フレーム` ツールを追加。空白をダブルクリックするとグループ枠を作成可能。
- ツールバーに縮小 / 拡大 / 全体表示を追加。
- モバイル・狭幅ではラベルを隠し、アイコン中心のコンパクト表示へ切替。
- キャンバス背景・カード選択状態・フレーム表示・接続線を調整。

## 効率面
- 新規ライブラリなし。
- サーバーAPI追加なし。
- 保存方式は localStorage + debounce のまま。
- ホワイトボード画面を開いていない時の負荷は増えない。

## 確認
- `node scripts/check-styles.mjs` OK
- `FreeformCanvasScreen.tsx` esbuild transpile OK
- `src` 配下の生成済み `.js` なし
