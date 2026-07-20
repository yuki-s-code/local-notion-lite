# v217 Transformer-first Evaluation Queue

## 目的

v216のシンプルな構成を維持しながら、実務で必要な「誤答率の最小化」と「改善サイクル」を追加しました。

## 変更点

- 回答採用経路を Transformers.js + SQLite FTS5 + metadata guard に一本化
- 旧 kuromoji / fuse / node-nlp / MiniSearch へのフォールバックを停止
- `likelyQuestions` / `paraphrases` をFAQ識別用Embedding・完全一致判定に追加
- `query-normalization.json` による表記揺れ補正を追加
- 高信頼には semantic だけでなく、FTSまたはmetadata一致の裏取りを要求
- 信頼度55%未満・未回答・評価セット不一致を `faq-improvement-queue.json` に保存
- `faq-evaluation-set.json` と一括評価APIを追加

## 追加ファイル

```txt
shared-folder/smart-assist/query-normalization.json
shared-folder/smart-assist/faq-improvement-queue.json
shared-folder/smart-assist/faq-evaluation-set.json
```

## 評価セット形式

```json
[
  {
    "question": "学童クラブの費用はどれくらいですか",
    "expectedFaqId": "faq_001_afterschool_fee"
  },
  {
    "question": "減免について教えて",
    "expectedFaqId": "faq_002_afterschool_reduction"
  }
]
```

## FAQ強化フィールド

```json
{
  "likelyQuestions": [
    "学童クラブの費用はどれくらいですか",
    "学童の利用料はいくらですか",
    "放課後児童クラブの料金を確認したい"
  ],
  "paraphrases": [
    "クラブ費用",
    "月額利用料",
    "利用料の確認"
  ]
}
```
