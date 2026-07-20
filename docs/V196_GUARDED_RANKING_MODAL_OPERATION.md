# v196 Guarded Ranking + Modal Operation Panel

## 目的

v195で導入した Hybrid Guarded Ranking をさらに厳格化し、低信頼時に誤ったFAQ本文を返さないようにした。
また、Smart Assist 運用パネルを右サイド常時表示からモーダル表示へ変更し、画面を見やすくした。

## 精度改善

### 1. 低信頼時は本文回答しない

v195では信頼度が低でも、45%以上の場合は候補FAQの本文を表示することがあった。
そのため「有給はいつから取得できますか」に対して、休暇カテゴリ内の別FAQである「子どもの体調不良」FAQが本文回答される可能性があった。

v196では `uxLevel === 'low'` の場合、本文回答を行わず、カテゴリ・手続き名・不足情報の確認を優先する。

### 2. Intent Hint Hard Guard

共有言い換え辞書 `smart-assist/synonyms.json` に `intentId` が設定されている場合、そのIntentと候補FAQのIntentが一致するかを強く評価する。

例:

```json
{
  "base": "年次有給休暇",
  "variants": ["有給", "有休", "年休"],
  "category": "休暇",
  "intentId": "leave.paid_start"
}
```

ユーザー入力に「有給」が含まれた場合、`leave.paid_start` 以外のFAQは強く減点される。

### 3. Question Type Guard

カテゴリが同じでも質問タイプが違うFAQを減点する。

例:

- 「有給はいつから取得できますか」 → `start_or_grant`
- 「子どもが熱で急に休みたい」 → `urgent_child_care`
- 「必要書類は何ですか」 → `required_documents`
- 「申請を取り消したい」 → `cancel_or_correction`

これにより、休暇カテゴリ内でも「有給の取得開始」と「子の看護」を分離する。

### 4. keywords保持

FAQ JSONの `keywords` を保存時に保持するようにした。
これにより、ユーザーがFAQ JSONに登録したキーワードがランキング判断に使いやすくなる。

## UI改善

### 運用パネルのモーダル化

右サイドには小さな「運用パネルを開く」ボタンだけを表示する。
クリックするとモーダルで以下を操作できる。

- 再インデックス
- node-nlp再学習
- 低信頼ログ
- FAQ JSON取込
- 言い換え辞書編集
- FAQテスト結果確認

## 共有ファイル

```txt
共有フォルダ/
  smart-assist/
    faq-items.json
    synonyms.json
    chat-logs.json
    faq-search-index.json
```

## 推奨運用

1. FAQ JSONを取り込む
2. 言い換え辞書に現場の表現を追加する
3. 再インデックスを実行する
4. node-nlp再学習を実行する
5. FAQカードのテストで想定質問を確認する
6. 低信頼ログから不足FAQを追加する

