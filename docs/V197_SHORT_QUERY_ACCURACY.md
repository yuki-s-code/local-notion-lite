# v197 Short Query Accuracy Upgrade

## 目的
短い質問文でも、FAQの親カテゴリ・Intent・言い換え辞書を使って正しいFAQへ寄せる。

例:

```txt
有給はいつから取得できますか
```

従来は「休暇」カテゴリまでは推定できても、子の看護FAQや低信頼判定へ落ちることがあった。

## 追加内容

- 短文強一致ブースト
- 有給/有休/年休 + いつから/付与/使える/取得 の複合判定
- `leave.paid_start` があれば最優先
- `leave.paid_start` がない場合でも、年休/有休の親FAQへフォールバック
- 子の看護FAQを短文取得開始質問から除外
- 候補差分補正で短文強一致がある場合はmarginを過度に下げない
- node-nlpに `leave.paid_start` の初期学習例を追加
- Intent Profileに `leave.paid_start` / `leave_vacation` / `annual_leave` のaliasを追加

## 運用ポイント

短文で正確に当てるには、FAQに次のどれかを入れると精度が上がる。

```json
{
  "intentId": "leave.paid_start",
  "tags": ["有給", "有休", "年休", "年次休暇", "付与日", "取得開始"],
  "testQuestions": ["有給はいつから取得できますか", "有休はいつから使えますか"]
}
```

専用FAQがない場合でも、親FAQに `testQuestions` と `tags` を追加すればフォールバック対象になる。
