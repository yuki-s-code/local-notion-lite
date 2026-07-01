# v206 Transformers.js Semantic Hybrid Search

## 目的

v205までの TF-IDF風ベクトル検索は軽量だが、言い換えや自然文の意味的な近さに限界があった。
v206では LangChain.js は使用せず、Transformers.js を候補検索レイヤーとして追加し、FAQの意味ベクトルを自動生成する。

## 採用モデル

既定モデル:

```txt
Xenova/paraphrase-multilingual-MiniLM-L12-v2
```

理由:

- 日本語を含む多言語文のSentence Embeddingに対応
- 384次元で比較的軽量
- Transformers.jsから feature-extraction pipeline で利用可能
- FAQ検索、意味類似、クラスタリング用途に向く

## 共有フォルダに追加されるファイル

```txt
smart-assist/
  faq-items.json
  synonyms.json
  rule-profiles.json
  search-index.json
  semantic-index.json
```

`semantic-index.json` はFAQごとの意味ベクトルを保存する。
FAQ本文や質問、keywords、examples、testQuestionsが変わった場合は `textHash` が変わり、そのFAQだけ再ベクトル化される。

## 検索構成

```txt
ユーザー質問
  ↓
正規化・言い換え展開
  ↓
既存検索
  - kuromoji + n-gram
  - MiniSearch / BM25風
  - exact / keywords / testQuestions
  ↓
Transformer意味ベクトル検索
  ↓
候補統合
  ↓
Guarded Ranking
  ↓
回答
```

## 残しているもの

Transformer検索だけにすると、短文・固有名詞・業務用語で誤ヒットする可能性がある。
そのため、以下は残している。

- kuromoji + n-gram
- exact phrase boost
- testQuestions完全一致
- synonyms.json
- rule-profiles.json
- negativeTerms
- top1/top2 margin
- 低信頼時の確認質問

## 追加API

```http
GET /smart-assist/semantic-index
```

意味ベクトルインデックスの状態を確認できる。

## 注意

初回はTransformers.jsがモデルを取得するため、ネットワーク接続が必要になる場合がある。
一度キャッシュされれば、以後はローカルキャッシュを利用できる。
モデルを完全同梱する場合は、将来 `embedding-settings.json` でローカルモデルパスを指定する構成に拡張する。
