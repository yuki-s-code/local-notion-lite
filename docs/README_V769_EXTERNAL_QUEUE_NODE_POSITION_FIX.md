# V769 External Queue Node Position Fix

## 修正内容

- External SourcesからCalendar予定を議事録ノート化する際に、`addNode`へ必須の`x`・`y`座標が渡されていなかった型エラーを修正。
- Gmailメールを対応タスクノート化する際にも、同様に`x`・`y`座標を追加。
- キュー内の複数項目をまとめて追加した場合、追加順と既存ノード数を考慮して位置をずらす共通配置処理を追加。
- `FreeformCanvasScreen.tsx`内の`addNode`呼び出しを確認し、座標欠落は上記2箇所のみであることを確認。

## 検証

- TypeScript transpile構文診断: 0件
- 既存ノード形式・保存形式への変更なし
