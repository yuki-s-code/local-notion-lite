# v91 Inbox / Quick Capture

## 目的
ページ・データベース・Journal が揃った後の実利用で必要になる「あとで整理する場所」を追加しました。

## 追加内容
- `Cmd/Ctrl + Shift + Space` で Quick Capture を開く
- 入力したメモを `inbox/items.json` に保存
- サイドバーから Inbox を開く
- Inbox item をページ化
- Inbox item を今日のJournalへ送る
- 削除

## 保存先

```txt
YourAppVault/
  inbox/
    items.json
```

## 方針
Inbox は正本データを共有フォルダへ保存します。ローカルSQLiteへはまだ入れず、まずは軽く安定するファイルベースで実装しています。
