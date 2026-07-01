# v205 Generic Weighted Semantic Vector Search

v205では、個別業務に特化したガードを増やす方向ではなく、FAQ全般で使える汎用ベクトル検索に寄せました。

## 目的

- FAQが増えても、汎用語だけでサブFAQが高信頼になりにくくする
- `学童`, `減免` などの個別語に依存しない
- FAQの質問・例文・テスト質問・キーワードを強く、回答本文を弱く扱う
- kuromoji + n-gram は維持しつつ、検索ベクトルの重み付けを改善する

## 主な変更

- search-index.json を version 205 に更新
- engine を `generic-weighted-semantic-vector-v205` に更新
- FAQの項目ごとに明示的なフィールド重みを付与
  - question / testQuestions / examples / keywords を強く評価
  - answer は弱く評価
- FAQ固有語 `distinctiveTerms` を自動抽出
- 一般語 `commonTerms` を自動抽出
- 短い質問で一般語しか一致しない場合は信頼度を抑制
- 個別の「減免FAQ抑制」などのハードコードを削除し、汎用的な固有語ガードへ移行

## インデックス保存先

```txt
smart-assist/search-index.json
```

## 期待される効果

例えばFAQが以下のように増えても、

- 費用の確認
- 減免制度
- 支払方法
- 延長料金
- 長期休業期間の追加料金

`費用の確認をしたい` のような汎用質問では、`減免` のような固有語が質問にない限り、減免FAQを高信頼で確定しにくくなります。

## 注意

ベクトルは外部AIモデルではなく、ローカルの軽量TF-IDF風ベクトルです。
そのため完全な意味理解ではありませんが、Electron + 共有フォルダ運用では軽量で安定します。
