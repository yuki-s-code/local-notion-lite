# v9 Database Views

v9 では Notion らしいデータベース操作に近づけるため、テーブルDBにビュー機能を追加しました。

## 追加内容

- ビュー作成
- ビュー切替
- ビュー名変更
- フィルター条件の保存
- ソート条件の保存
- 表示件数 / 全件数の表示

## 保存形式

`databases/db_xxxxx.json` に以下のフィールドが追加されます。

```json
{
  "views": [
    {
      "id": "view_default",
      "name": "Default Table",
      "type": "table",
      "filters": [],
      "sorts": []
    }
  ],
  "activeViewId": "view_default"
}
```

## 注意

v9 のフィルター・ソートはまずクライアント側で処理しています。共有フォルダ正本の構造を壊さず、既存DBとも互換性を保つためです。

今後の候補:

- 列名変更
- 列削除
- select候補編集
- Relation プロパティ
- ページDB埋め込み
- カレンダービュー / ボードビュー
