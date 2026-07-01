# v195 Hybrid Guarded Ranking & Shared Synonyms

## 目的

v194で確認された「有給はいつから取得できますか」に対してLGWAN FAQが高信頼で返る問題を防ぐため、回答採用前にカテゴリ・Intent・キーワード重なり・候補差分をチェックする防御型ランキングを追加しました。

## 追加した精度アルゴリズム

### Hybrid Guarded Ranking

1. ユーザー入力を正規化
2. FAQ JSONと共有言い換え辞書で検索語を展開
3. 既存のkuromoji + Fuse + node-nlpで候補を取得
4. カテゴリガードで明らかに違う候補を強く減点
5. キーワード重なりを加点
6. node-nlp Intent不一致を減点
7. top1 / top2 の差が小さい場合は信頼度を下げる
8. 信頼度の上限を96%に制限

これにより、例えば「有給」「有休」「年休」が含まれる質問では、休暇カテゴリを優先し、情報システムやLGWANカテゴリは採用されにくくなります。

## 共有言い換え辞書

保存先はFAQ JSONと同じ共有フォルダです。

```txt
sharedRoot/smart-assist/synonyms.json
```

形式は以下です。

```json
[
  {
    "id": "syn_leave_paid",
    "base": "年次有給休暇",
    "variants": ["有給", "有休", "年休", "年次休暇", "有給休暇"],
    "category": "休暇",
    "intentId": "leave.paid_start",
    "enabled": true
  }
]
```

## 追加API

```txt
GET    /smart-assist/synonyms
PUT    /smart-assist/synonyms
POST   /smart-assist/synonyms
DELETE /smart-assist/synonyms/:id
```

## UI変更

Smart Assist運用パネルに「言い換え辞書」ボタンを追加しました。
JSON形式で直接編集・保存できます。

## 追加サンプルFAQ

「有給休暇・年次休暇はいつから取得できますか？」をサンプルFAQに追加しました。

## 注意

既に既存の `faq-items.json` がある環境では、サンプルFAQは自動上書きされません。必要な場合は、FAQ JSONを再インポートしてください。
