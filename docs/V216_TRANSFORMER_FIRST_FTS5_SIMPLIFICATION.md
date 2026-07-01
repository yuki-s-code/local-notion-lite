# v216 Transformer-first + SQLite FTS5 Simplification

## 方針

`kuromoji.js`、`fuse.js`、`node-nlp`、`MiniSearch` を Smart Assist の回答採用経路から外し、Transformers.js の意味検索を主軸にしました。固有名詞・制度名の完全一致補完には SQLite FTS5 trigram を使います。

## 現在の検索経路

1. FAQの `title / question / intent / keywords / tags / examples / testQuestions` から identity embedding を生成
2. FAQの `answer / followUpQuestions / suggestedActions / nextQuestions` から content embedding を生成
3. ユーザー質問を Transformers.js でベクトル化
4. semantic-index.json の identity embedding と cosine 類似度で候補化
5. SQLite FTS5 trigram で固有名詞・制度名・短文の表層一致を補完
6. metadata / exact / testQuestions / negativeTerms で最終ガード
7. 高信頼・中信頼・低信頼に分岐

## 削減した依存

`package.json` から以下を削除しました。

- fuse.js
- kuromoji
- node-nlp
- minisearch

レガシーファイルは残していますが、Smart Assist の通常回答経路では使用しません。

## 共有ファイル

```txt
smart-assist/
  faq-items.json
  semantic-index.json
  chat-logs.json
```

## 注意

FAQ JSON取込後、必ず運用パネルから「検索・意味ベクトル再生成」を実行してください。
