# V190 node-nlp Chatbot Layer

## 目的

V189 の `Intent Schema Accuracy Engine` を維持したまま、`node-nlp` を Intent 分類レイヤーとして追加した。

## 追加内容

- `node-nlp` を依存関係に追加
- `src/server/services/nodeNlpFaqEngine.ts` を追加
- `POST /smart-assist/chat/ask` を追加
- `ApiClient.askSmartAssist(message, debug)` を追加
- FAQ JSON の `intent`, `intentId`, `intentIds`, `intentLabel`, `domain`, `domainId` を保存対象に追加

## 処理フロー

```txt
ユーザー質問
  ↓
node-nlp Intent分類
  ↓
既存 kuromoji + Fuse + Intent Metadata Gate 検索
  ↓
node-nlp の Intent と FAQメタデータが一致すれば再スコアリング
  ↓
回答、信頼度、根拠、関連FAQを返却
```

## API

```http
POST /smart-assist/chat/ask
Content-Type: application/json
```

```json
{
  "message": "申請期限が過ぎてしまった",
  "debug": true
}
```

レスポンス例:

```json
{
  "answer": "...",
  "confidence": 94,
  "confidenceLabel": "高",
  "intent": "missed_deadline",
  "intentScore": 0.93,
  "matchedFaqId": "faq_xxx",
  "matchedFaqTitle": "申請期限が過ぎた場合",
  "reasons": ["node-nlp Intent一致: missed_deadline", "期限超過・申請遅れの意図に一致"],
  "sources": [{ "title": "FAQ", "type": "faq" }],
  "related": []
}
```

## FAQ JSON の推奨メタデータ

```json
{
  "question": "申請期限が過ぎた場合はどうすればよいですか？",
  "answer": "...",
  "category": "申請",
  "intentId": "missed_deadline",
  "intentLabel": "申請期限超過",
  "domain": "procedure",
  "tags": ["申請", "期限", "締切", "期限後"]
}
```

## 設計メモ

`node-nlp` のみで回答を決めるのではなく、既存の厳格検索結果を補正する。これにより、自然文の意図理解を強化しつつ、誤回答を抑制する。
