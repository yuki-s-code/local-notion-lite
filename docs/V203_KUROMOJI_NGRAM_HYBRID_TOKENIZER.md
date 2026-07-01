# v203 Kuromoji + n-gram Hybrid Tokenizer

v203では、v202の軽量ハイブリッド検索に **kuromoji形態素解析 + n-gramフォールバック** を追加しました。

## 目的

v202の `search-index.json` はn-gram中心だったため、短文や未知語には強い一方で、日本語の意味単位を十分に保持しにくい課題がありました。

v203では以下を両立します。

- kuromoji: 「放課後児童クラブ」「利用料」「年次休暇」など意味単位に強い
- n-gram: 「学童費用」「有休いつから」「申請取消」など短文・略語・スペースなし入力に強い

## 保存先

共有フォルダの構成はこれまでと同じです。

```txt
smart-assist/
  faq-items.json
  synonyms.json
  rule-profiles.json
  search-index.json
  chat-logs.json
```

`search-index.json` の `version` は `203` になり、各FAQに以下が保存されます。

```json
{
  "kuromojiTerms": ["放課後児童クラブ", "利用料", "確認"],
  "ngramTerms": ["学童", "費用", "童費", "費用"],
  "terms": ["放課後児童クラブ", "学童", "利用料", "費用"]
}
```

## 仕組み

1. FAQの質問、回答、keywords、examples、testQuestions、suggestedActions、nextQuestionsを検索用テキストにまとめる
2. kuromojiで形態素解析する
3. 同義語・汎用語・明示キーワードを追加する
4. n-gramも併用する
5. TF-IDF風ベクトルを自動生成する
6. BM25風スコア、cosine類似度、kuromoji一致、完全一致を合成して再ランキングする

## 失敗時の扱い

kuromoji辞書の読み込みに失敗した場合でも、n-gramフォールバックで検索は継続します。Electron配布時や環境差による辞書読み込み失敗でチャットボット全体が止まらないようにしています。

## 運用メモ

FAQ JSONを取り込んだ後、またはFAQを更新した後は、運用パネルの「再インデックス」を押すと `search-index.json` が再生成されます。通常はFAQ保存時にも自動生成されます。
