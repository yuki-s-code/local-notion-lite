# V317 AI Stability and Feedback Fix

## 目的
v316で追加した回答フィードバック・未回答改善ループを安定化し、生成AI設定のミスを減らす。

## 修正内容

### 1. フィードバック保存スキーマ修正
- UIは `rating: "good" | "bad"` を送信するため、サーバー側バリデーションも `good / bad / 1〜5数値` に対応。
- `answerPreview`, `reason`, `matchedFaqId`, `expectedFaqId`, `confidence`, `candidates`, `status`, `sourceIds` 等も正式に許可。

### 2. 保存失敗時のUIロールバック
- 「役に立った / 違う」を押した後、保存に失敗した場合は楽観表示を戻す。
- 保存できていないのに「記録済み」に見える状態を防止。

### 3. 共有フォルダ保存の最低限マージ
- フィードバック追加時、保存直前に再読込してID基準でマージ。
- 改善キュー追加時も保存直前に再読込してID基準でマージ。
- 複数端末の同時保存で直前データを潰しにくくする。

### 4. llama-completion前提の文言修正
- エラーメッセージを `llama-cli` 前提から `llama-completion / llama-cli` 前提へ修正。
- UIの説明も非対話生成では `llama-completion` を優先する旨に更新。

### 5. 生成AI推奨設定ボタン
- 生成AI設定画面に「推奨設定を適用」を追加。
- 推奨値:
  - provider: llama-cpp
  - preset: light
  - contextSize: 2048
  - maxTokens: 256
  - temperature: 0.1
  - timeoutMs: 120000

## 確認項目
1. チャット回答下の「役に立った / 違う」を押して保存できること。
2. 保存失敗時に「記録済み」表示が残らないこと。
3. 「違う」を押すと未回答・改善ログへ登録されること。
4. 生成AI設定画面で「推奨設定を適用」が表示されること。
5. llamaエラー文言が `llama-completion` を含む表記になっていること。
