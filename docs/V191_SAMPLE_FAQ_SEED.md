# v191 サンプルFAQ同梱

## 目的

node-nlp 版チャットボットをすぐ試せるように、FAQが空の新規ワークスペースへサンプルFAQを自動投入します。

## 仕様

- 対象ファイル: `SmartAssist/faq-items.json`
- 既存FAQが1件以上ある場合: 何もしません
- FAQが空、またはファイルが存在しない場合: サンプルFAQを自動作成します
- サンプルFAQは `approved` / `reviewed` 状態で登録されます
- `intentId` / `intent` / `intentLabel` を付与しているため、node-nlp のIntent分類にも使われます

## サンプルFAQカテゴリ

- 申請・手続き
- 勤務条件
- 休暇
- 給与・手当
- 利用条件・要件
- 変更・取消
- 放課後児童クラブ
- 情報システム

## 試験用質問例

```txt
申請期限が過ぎてしまった
提出期限を過ぎたけど申請できますか
申請方法を教えて
必要書類は何ですか
勤務時間を変更したい
年休を取りたい
子どもが熱で急に休みたい
通勤手当は出ますか
給与の支給日を確認したい
対象要件を教えて
申請内容を取り消したい
放課後児童クラブの費用を確認したい
LGWANで外部サービスを使っていいですか
```

## 確認API

```http
GET /smart-assist/faqs
```

```http
POST /smart-assist/chat/ask
Content-Type: application/json

{
  "message": "申請期限が過ぎてしまった",
  "debug": true
}
```

## 実装ファイル

- `src/server/services/sampleSmartFaqRecords.ts`
- `src/server/services/vaultService.ts`
  - `listSmartFaqRecords()` で空FAQ時のみサンプル投入
  - `followUpQuestions` をFAQレコードとして保持
