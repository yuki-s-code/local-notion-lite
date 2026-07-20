# V265 Database Sidebar Tree Visibility Fix

## 対応内容

- サイドバーのデータベースツリーで、データベースタイトルが見えなくなる問題を修正。
- DBツリー専用のコンパクトなクラスへ変更し、既存の `.db-sidebar-item-v61` の `!important` 指定と衝突しないように整理。
- DB / DB行 / 子ページの行間を圧縮し、視認性を改善。
- DB行から作成した子ページが通常のページツリーに出ないように修正。
- 新規作成されるDB行子ページは `parentId = database-row:<databaseId>:<rowId>` を持つように修正。
- 既存のDB行子ページについても、DB行本文の `childPageIds` に含まれるページはページツリーから除外。

## 方針

DB行子ページは通常ページとして保存するが、サイドバー表示上は通常ページツリーではなく、データベースツリー配下に表示する。

```txt
ページツリー
  通常ページのみ

データベースツリー
  DB
    DB行
      DB行子ページ
```

## 非対象

- package-lock.json
- GitHub Actions
- kuromoji
- node-nlp
