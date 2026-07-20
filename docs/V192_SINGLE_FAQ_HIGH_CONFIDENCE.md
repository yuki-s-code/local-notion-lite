# V192 Single FAQ High Confidence Fix

## 目的

高信頼Intent/FAQ一致時に、別カテゴリ・別IntentのFAQ本文が回答に混ざる問題を抑制します。

## 変更内容

- チャット送信時の優先APIを `/smart-assist/chat/ask` に変更
- サーバーの `askSmartAssist` 結果は、原則として `matchedFaqId` の1FAQ本文だけを回答に使用
- 高信頼時は `answerPolicy: single-faq-high-confidence` を返却
- 関連候補は同一カテゴリまたは同一Intentグループに制限
- `申請後に内容を取り消したい場合` のサンプルFAQを強化
- `勤務時間変更` のIntentから汎用 `change_cancel` を外し、取消Intentとの混線を低減

## 期待される挙動

質問: `申請した後に取り消したい`

期待回答:

- 申請取消FAQの本文だけを回答に使う
- 勤務時間変更、年休、必要書類などの別FAQ本文を混ぜない
- 関連質問も取消FAQの followUpQuestions を中心に表示する

## 注意

既存のFAQデータがすでに保存されている場合、サンプルFAQは自動上書きされません。
古いサンプルFAQを試験中の場合は、FAQ管理画面で再インポートするか、共有フォルダの `smart-assist/faq-items.json` をバックアップ後に削除してから起動してください。
