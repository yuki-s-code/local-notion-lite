# V273 Page to database-row link property/backlink fix

## 目的
通常ページ本文からDB行リンクを貼った場合に、見た目だけリンク化されるがクリックしても遷移しない、ページのプロパティ/リンク欄にDB行リンクが出ない、DB行側バックリンクに反映されにくい問題を修正する。

## 変更内容

### 1. DB行リンクのhrefをhash形式へ変更
BlockNote/Electronでカスタムプロトコル `local-dbrow://` が通常ページ本文内で安定してクリック処理されない場合があるため、新規挿入リンクは以下に変更。

```txt
#local-dbrow=<databaseId>&row=<rowId>
```

既存の以下形式も後方互換で読み取る。

```txt
local-dbrow://<databaseId>/<rowId>
[[dbrow:<databaseId>:<rowId>|title]]
```

### 2. 通常ページのリンク欄にDB行リンクを表示
`PageInfoPanel` のリンクタブに「リンクされたDB行」を追加。
クリックすると対象DBを開き、該当行プレビューを表示する。

### 3. DB行バックリンク抽出をhash形式に対応
サーバー側の `listDatabaseRowLinks()` が、通常ページ本文/BlockNote JSON内の `#local-dbrow=...&row=...` もDB行へのリンクとして検出できるようにした。

## 非対象
- package-lock.json
- GitHub Actions
- kuromoji
- node-nlp
