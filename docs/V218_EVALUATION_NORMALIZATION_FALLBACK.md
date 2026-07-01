# v218 Evaluation / Normalization / Fallback

## 目的
v217 の Transformer-first 構成を維持したまま、実務運用で重要な以下を追加した。

- 正答率の自動測定
- 表記揺れ辞書による検索前処理
- 0件・低信頼時のフォールバック

## 追加・強化した共有ファイル

```txt
shared-folder/smart-assist/query-normalization.json
shared-folder/smart-assist/fallback-contacts.json
shared-folder/smart-assist/faq-evaluation-set.json
shared-folder/smart-assist/faq-evaluation-report.json
shared-folder/smart-assist/faq-improvement-queue.json
```

## query-normalization.json

`rules` / `items` / 配列形式をすべて読み込める。

```json
{
  "version": 218,
  "rules": [
    { "from": "学童クラブ", "to": "放課後児童クラブ" },
    { "from": "有休", "to": "有給休暇" },
    { "from": "キャンセル", "to": "取消" }
  ]
}
```

検索前に NFKC 正規化と置換を行い、debug/reasons に置換内容を表示する。

## fallback-contacts.json

0件・低信頼時に候補3件と担当を返す。

```json
{
  "version": 218,
  "defaultContact": {
    "label": "担当係",
    "department": "担当課",
    "extension": "内線未設定"
  },
  "categories": [
    {
      "category": "放課後児童クラブ",
      "label": "放課後児童クラブ担当",
      "department": "青少年育成課",
      "extension": "内線未設定"
    }
  ]
}
```

## 正答率自動測定

運用パネルの「✅ 正答率自動測定」から `faq-evaluation-set.json` を一括実行する。
結果は `faq-evaluation-report.json` に保存される。

```json
[
  { "question": "学童クラブの費用はどれくらいですか", "expectedFaqId": "faq_001_afterschool_fee" },
  { "question": "減免について教えて", "expectedFaqId": "faq_002_afterschool_reduction" }
]
```

## 0件時フォールバック

該当FAQを十分な信頼度で特定できない場合は、旧検索エンジンへ戻さず、以下を返す。

- 断定回答しない説明
- 近い候補3件
- 担当係・部署・内線
- 再質問のヒント

誤答率を下げるため、行政FAQでは「答えない勇気」を優先する。
