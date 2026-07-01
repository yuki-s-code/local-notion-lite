# v202 Lightweight Hybrid Retrieval

LangChain.jsは導入せず、ローカル・共有フォルダ運用に合わせて軽量な検索強化を追加しました。

## 追加したもの

- MiniSearch互換の軽量全文検索レイヤー
- 自作TF-IDFベクトル化
- cosine similarityによる簡易ベクトル検索
- BM25風キーワード検索
- exact phrase / examples / testQuestions 完全一致ブースト
- FAQ保存・JSON取込・再インデックス時の自動ベクトル化
- 共有フォルダ `smart-assist/search-index.json` への検索インデックス保存
- 既存の Guarded Ranking / Intent / 言い換え辞書 / 汎用ルールとの統合

## 共有フォルダ構成

```txt
smart-assist/
  faq-items.json
  synonyms.json
  rule-profiles.json
  search-index.json
  chat-logs.json
```

## 検索の流れ

```txt
ユーザー質問
  ↓
言い換え・汎用ルール展開
  ↓
kuromoji + Fuse + 独自ランキング
  ↓
軽量ベクトル検索
  ↓
BM25風キーワード検索
  ↓
候補統合
  ↓
Guarded Ranking
  ↓
回答・次の提案
```

## 自動ベクトル化

FAQの以下の項目から検索用テキストを作ります。

- question
- answer
- category
- intentId / intentName / intentLabel
- tags
- keywords
- examples
- testQuestions
- suggestedActions
- nextQuestions

FAQを保存・取り込み・削除したタイミングで `search-index.json` を再生成します。

## 注意

`minisearch` は今後の拡張用に依存関係へ追加しています。v202では配布サイズを抑えるため、MiniSearch本体に強く依存せず、同等の軽量インデックスを自作実装しています。
