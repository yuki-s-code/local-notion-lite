# V133 Server Paging Table

## 目的
v132で追加したSQLiteページングAPIを、Tableビューの実表示に接続しました。
大量件数DBでReact側へ全行を一括展開し続けるのではなく、Tableはページ単位で行を取得できます。

## 追加内容

- `Server Table` トグルを追加
- Large DB Mode中のTableでサーバー側ページング表示を利用可能
- ページ送り UI を追加
- pageSize 50 / 120 / 250 / 500 を選択可能
- 検索語をサーバー側クエリへ渡す
- Query結果の mode / elapsedMs / total を表示
- ページサイズとServer Table設定をDBごとにlocalStorageへ保存

## 注意

- フィルター/ソートがあるビューはサーバー側でJSONフォールバックする場合があります。
- Rollup / Formula の完全なサーバー側計算は未対応です。クライアント側表示では従来通り計算されます。
- 行編集や追加は従来の自動保存を維持しています。

## 次の候補

- プロパティ単位のSQLiteインデックス
- filter/sort条件のSQL化
- Rollup/Formulaの計算キャッシュ
- 10万行向けの行API分離保存
