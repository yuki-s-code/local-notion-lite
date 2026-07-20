# V198 Generic Configurable FAQ Engine

## 目的

v197までは「有給」「申請取消」など個別チューニングがコード側に増えやすい構成だった。v198では、短い質問でも正確に当てるための補正を、共有フォルダのJSONで管理できるようにした。

## 追加ファイル

共有フォルダ配下に以下を追加する。

```txt
shared-root/
  smart-assist/
    faq-items.json
    synonyms.json
    rule-profiles.json
```

## rule-profiles.json

`rule-profiles.json` は、FAQのカテゴリ・Intent・質問タイプを補正する汎用ルール。

例:

```json
[
  {
    "id": "rule_leave_paid_start",
    "label": "有給・年休の取得開始",
    "enabled": true,
    "category": "休暇",
    "intentId": "leave.paid_start",
    "terms": ["有給", "有休", "年休", "年次休暇"],
    "boostTerms": ["いつから", "付与", "使える", "取得開始"],
    "questionTypes": ["start_or_grant"],
    "negativeTerms": ["子ども", "発熱", "保育園", "看護休暇"],
    "parentIntentIds": ["leave.annual", "leave_vacation"],
    "weight": 1.2
  }
]
```

## 使い方

1. Smart Assist 運用パネルを開く
2. 「🎯 汎用ルール」を開く
3. JSONを編集して保存
4. 必要に応じて「再インデックス」「node-nlp再学習」を実行

## 精度改善の考え方

短い質問は全文検索だけでは情報量が足りない。そこで以下を組み合わせる。

- 言い換え辞書: 表記ゆれ・同義語を補正
- 汎用ルール: カテゴリ、Intent、質問タイプを補正
- negativeTerms: 似ているが違うFAQを除外
- parentIntentIds: 専用FAQがない場合に親FAQへフォールバック

## v198の改善点

- 個別ロジックをJSON化し、業務分野が変わっても調整しやすくした
- 汎用ルール編集UIを運用パネルに追加
- `GET/PUT/POST/DELETE /smart-assist/rule-profiles` を追加
- 回答エンジン名を `generic-configurable-ranking-v198` に更新
