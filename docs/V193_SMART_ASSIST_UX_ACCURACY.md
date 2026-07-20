# V193 Smart Assist UX & Accuracy Upgrade

## 目的
v192 の「高信頼なら 1FAQ 固定」を維持しつつ、ユーザー体験と運用改善を強化しました。

## 追加・変更点

### 1. 質問補完・検索クエリ拡張
`/smart-assist/chat/ask` で、ユーザー入力をそのまま検索するだけでなく、kuromoji 解析・同義語展開・FAQメタデータを利用して検索用クエリを拡張します。

レスポンスには以下が追加されます。

- `expandedQuery`
- `expandedTerms`
- `uxLevel`: `high` / `medium` / `low`

### 2. 信頼度別UX

- `high`: 1FAQ固定。回答に他カテゴリのFAQを混ぜない。
- `medium`: 候補FAQを提示し、確認しやすくする。
- `low`: 無理に回答せず、カテゴリ候補と聞き返しを返す。

### 3. 回答フォーマット改善
高信頼時は以下の形式になります。

```txt
結論: ...

確認するとよいこと:
・...
・...
```

### 4. 回答ログ
チャット結果を `smart-assist/chat-logs.json` に保存します。

追加API:

```http
GET /smart-assist/chat/logs
GET /smart-assist/chat/low-confidence
```

低信頼だった質問を後から確認できるため、FAQ改善に使えます。

### 5. node-nlp 再学習API
FAQの `question` / `tags` / `intentId` / `intentLabel` などをもとに node-nlp を再学習します。

```http
POST /smart-assist/nlp/retrain
```

### 6. FAQテストAPI
FAQごとに `testQuestions` を持たせ、意図したFAQにヒットするか確認できます。

```http
POST /smart-assist/faq/test
```

リクエスト例:

```json
{
  "faqId": "faq_004_application_cancel",
  "questions": [
    "申請した後に取り消したい",
    "申請をキャンセルしたい"
  ]
}
```

## FAQ JSON の推奨プロパティ

```json
{
  "id": "faq_004_application_cancel",
  "question": "申請後に内容を取り消したい場合はどうすればよいですか？",
  "answer": "...",
  "category": "申請・手続き",
  "intentId": "application.cancel",
  "intentLabel": "申請取消",
  "tags": ["申請", "取消", "キャンセル", "取り下げ"],
  "followUpQuestions": ["どの手続きを取り消したいですか？"],
  "testQuestions": ["申請した後に取り消したい", "申請をキャンセルしたい"]
}
```

## 既知の注意
このZIPには `node_modules` は含めていません。展開後に以下を実行してください。

```bash
npm install
npm run typecheck
npm run dev
```

この作業環境では `node_modules` が無いため、typecheck は `node` / `electron` 型定義不足で完了していません。
