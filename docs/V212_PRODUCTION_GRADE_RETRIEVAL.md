# v212 Production-grade FAQ Retrieval

## 目的

v212では、Transformers.jsを「最終判断」ではなく、実務向けの候補検索レイヤーとして正しく使うために、意味ベクトル検索を二重化しました。

## 追加・変更内容

- `semantic-index.json` を version 212 に更新
- `identityEmbedding` と `contentEmbedding` を分離
- 検索時は `identityEmbedding` を主信号として使用
- `contentEmbedding` は補助信号として使用
- RRF風の順位統合を追加
- answer本文の意味一致だけで高信頼になりにくいように調整
- 既存の kuromoji / n-gram / BM25風検索 / negativeTerms / Guarded Ranking は維持
- debug時に semantic breakdown を候補理由へ表示

## Identity Embedding

FAQを識別するためのベクトルです。

主に以下を使います。

- title
- question
- intentId / intentName / intentLabel
- category
- tags
- keywords
- examples
- testQuestions
- negativeTerms

回答本文は含めません。

## Content Embedding

回答内容の補助確認用ベクトルです。

主に以下を使います。

- answer
- followUpQuestions
- suggestedActions
- nextQuestions

ただし、Content Embeddingのみで高信頼にすることは避けます。

## なぜ分けるのか

1本のEmbeddingにanswer本文まで混ぜると、一般費用FAQの本文に「減免制度については...」のような補足があるだけで、減免質問に対して一般費用FAQが近く見えることがあります。

v212では、FAQの主題判定をIdentity Embeddingへ寄せることで、実務FAQで重要な「主題の一致」を優先します。

## 再生成

アップデート後は、運用パネルから以下を実行してください。

```txt
検索・意味ベクトル再生成
```

これにより `smart-assist/semantic-index.json` がv212形式で再生成されます。
