# V215 Stable Metadata-first Retrieval

検索できない・文脈に引っ張られる・意味ベクトルが関連FAQを高信頼にする問題を止めるため、回答採用の最初に安定版metadata-first検索を入れました。

## 方針

- 会話履歴、answer本文、Transformer意味検索の影響を最初の回答採用では使いすぎない
- title / question / category / intent / keywords / tags / examples / testQuestions を優先
- negativeTerms はEmbedding対象ではなく除外専用
- 主題が違うFAQは高信頼にしない
- 50%以上なら候補回答、85%以上なら高信頼

## 効果

- 「学童クラブの費用」→ 一般費用FAQ
- 「減免について」→ 減免FAQ
- 直前会話に引っ張られにくい

## 注意

FAQ JSONを取り込んだ後は、運用パネルで「検索・意味ベクトル再生成」を実行してください。
