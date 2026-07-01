# V321 Workspace Semantic SQLite Cache

## 目的

v319 の Smart Assist / FAQ 専用 Ruri-v3 SQLite キャッシュを、Workspace Semantic Index 側にも広げました。

対象は、まず効果が大きく壊れにくい文章系データです。

- FAQ
- ページ本文
- Journal本文
- 既存の関連表示用 DB行チャンク

ただし、DB行の構造化フィルタ・ソート・Relation・Rollup は通常SQLite/既存インデックスの対象であり、Ruri-v3意味検索の対象ではありません。

## 保存先

検索AI設定の「ローカルSQLiteキャッシュ保存先」で指定したユーザー指定ローカルフォルダを使います。

```txt
<指定フォルダ>/workspace-semantic-cache.sqlite
```

共有フォルダは正本、SQLiteは再構築可能な高速キャッシュです。

## 追加内容

- Workspace Semantic Index をローカルSQLiteにも保存
- `workspace_semantic_items` テーブルを追加
- `workspace_semantic_meta` テーブルを追加
- 起動時/検索時はSQLiteキャッシュを優先読込
- JSON index が存在する場合はSQLiteへ移行保存
- 再生成時はJSONとSQLiteの両方を更新
- 管理画面にWorkspace Semantic SQLiteキャッシュ状態を表示

## 期待効果

- 関連ページ・関連FAQ・関連Journal候補の読み込み安定化
- 大量ページ/Journal時のインデックス再利用
- ユーザー指定ローカルフォルダによる共有フォルダ負荷軽減

## 注意

SQLiteキャッシュは正本ではありません。壊れた場合は削除して再生成できます。
