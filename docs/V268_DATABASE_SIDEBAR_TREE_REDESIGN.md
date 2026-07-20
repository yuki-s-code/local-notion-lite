# V268 Database Sidebar Tree Redesign

## 対応内容

- データベースサイドツリーを「現在の状態から再取得するナビゲーション」として見直した。
- DB行子ページを削除・ゴミ箱移動・完全削除した後に、データベースツリー側へ残り続けないようにした。
- サイドバーのDBツリーをコンパクト表示に再調整した。
- 展開済みDB・展開済みDB行だけを再取得し、全DB行を毎回描画しない設計は維持した。

## 主な修正

### サーバー側

- `listDatabaseSidebarRows()` の子ページ件数算出を修正。
  - `childPageIds` に残っていても、対象ページが存在しない・ゴミ箱入りの場合は件数に含めない。
- `DatabaseRowContentService.removeChildPageReference(pageId)` を追加。
  - ページをゴミ箱移動・完全削除した際に、DB行本文の `childPageIds` から該当IDを掃除する。

### Renderer側

- `reload()` 実行時にデータベースサイドバーの refresh key を更新するようにした。
- ページのゴミ箱移動・完全削除・ゴミ箱空操作で `local-notion:page-tree-mutated` イベントを発火。
- `DatabaseSidebarTree` が `local-notion:page-tree-mutated` / `local-notion:database-sidebar-refresh` を購読し、展開中ノードだけ再取得するようにした。
- 削除された pageId は、サイドバーの子ページキャッシュから即時除外する。

## レイアウト

- DB / 行 / 子ページの高さを詰め、ページツリーに近い密度に調整。
- DBタイトルは1行省略、子ページもコンパクト表示。
- 手動更新ボタンを追加。

## 非対象

- package-lock.json
- GitHub Actions
- kuromoji / node-nlp
