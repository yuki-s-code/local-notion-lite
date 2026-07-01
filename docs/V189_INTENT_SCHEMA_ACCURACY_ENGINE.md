# V189 Intent Schema Accuracy Engine

## 目的

FAQを「広く拾う」だけでなく、正確性を優先して回答するため、FAQデータに `intent` / `domain` メタデータを持たせられるようにしました。

## 追加メタデータ

FAQ JSONには任意で以下を指定できます。

```json
{
  "intentId": "annual_leave",
  "domain": "leave",
  "intentLabel": "年次有給休暇"
}
```

複数意図を持つ場合は以下も使えます。

```json
{
  "intentIds": ["required_documents", "application_method"],
  "domain": "procedure"
}
```

## 推奨Intent

- `annual_leave` 年次有給休暇
- `child_care_leave` 子の看護・休暇
- `missed_deadline` 期限超過・申請遅れ
- `change_request` 変更・修正
- `work_requirement` 就労要件
- `allowance_dependent` 扶養手当
- `commute_allowance` 通勤手当
- `fee_discount` 料金・減免
- `required_documents` 必要書類
- `application_method` 手続き・申請
- `overview` 概要・意味

## 方針

1. 質問文からIntentを推定
2. FAQに明示Intentがあれば最優先
3. Intentが一致するFAQを大幅加点
4. Intentが違うFAQは大きく減点
5. 根拠が弱い場合は断定せず低信頼回答にする

これにより、例えば「有給はいつから使用できる？」に扶養手当や通勤手当が混ざりにくくなります。
