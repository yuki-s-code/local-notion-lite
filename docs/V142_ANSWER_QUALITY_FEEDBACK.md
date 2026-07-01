# V142 Answer Quality / Feedback Learning

Local Generative Assist の回答精度を上げるため、信頼度制御とフィードバック学習を追加しました。

## 追加内容

- 回答ごとの信頼度を `high / medium / low / insufficient` で表示
- 根拠が弱い場合は断定せず、FAQ追加・質問具体化を案内
- 回答に対して「正しい」「違う」を記録可能
- フィードバックは共有フォルダ `smart-assist/answer-feedback.json` に保存
- 正しい回答で使われた根拠は次回以降スコアを上げる
- 違う回答で使われた根拠は次回以降スコアを下げる
- 回答品質カードで承認FAQ、確認済みFAQ、正しい/違う件数を確認可能

## 目的

Ollamaや大型LLMを使わない完全ローカル方式では、回答生成そのものよりも「根拠の選び方」と「答えてよいかの判断」が重要です。V142では、根拠が弱い質問に対して無理に回答しない安全寄りの挙動にしました。

## 保存先

```txt
shared-root/smart-assist/answer-feedback.json
```

FAQ本体と同じく共有フォルダ側に保存するため、複数端末で品質改善を共有できます。
