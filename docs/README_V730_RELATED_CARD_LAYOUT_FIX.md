# v730 Related card layout fix

## 修正内容

- 関連ページカードで「意味類似」「本文一致」「関連補正」がタグチップと内訳行の両方に出る重複を解消。
- `item.reasons` を一致タグ候補に混ぜる処理を停止し、タグ・キーワード・intentだけをチップ表示。
- スコア内訳は `意味 / 本文 / メタ / 補正` の短い1行表示に統一。
- 根拠抜粋を2行でclampし、長いプロパティ文字列や本文がカード外にはみ出さないように修正。
- タイトル、タグ、スコア内訳、日時に `min-width: 0` / ellipsis / overflow制御を追加。
- 右パネル幅が狭い場合でも関連カードが枠内に収まるようCSSを追加。

## 確認

- `node scripts/check-styles.mjs` OK
- `WorkspaceRelatedPanel.tsx` TSX transpile OK
- `src` 配下の生成済み `.js` なし

