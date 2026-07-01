# v96 Database views, Board View, Relation

## 追加内容

- Table / Board のビュー保存
- ビューごとの Filter / Sort / Group設定
- Board View
  - select / checkbox / 任意プロパティでグループ化
  - カード形式で行を表示
  - selectプロパティの場合はカード上でレーン移動相当の値変更
- Relationプロパティ
  - 同じデータベース内の他行を関連付け
  - セル上で複数選択
  - Row detailでも関連行を確認

## 保存形式

`databases/db_xxx.json` の `views` と `properties` に保存されます。

```json
{
  "views": [
    {
      "id": "view_xxx",
      "name": "Board",
      "type": "board",
      "groupByPropertyId": "prop_status",
      "filters": [],
      "sorts": []
    }
  ],
  "properties": [
    {
      "id": "prop_related",
      "name": "Related",
      "type": "relation",
      "relationDatabaseId": "db_xxx"
    }
  ]
}
```

## 方針

Relationはまず軽量・高速にするため、同一DB内の行Relationから開始しています。別DB同士のRelationは次段階で `relationDatabaseId` を使って拡張できます。
