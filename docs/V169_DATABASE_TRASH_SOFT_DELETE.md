# v169 Database Trash Soft Delete

## 目的
Private / Shared のデータベースを削除したときに、即完全削除されず、ページと同じようにゴミ箱へ入るように修正しました。

## 修正内容
- `DELETE /databases/:id` は物理削除ではなく soft delete になりました。
- DB JSON に `trashed: true` / `deletedAt` を保持します。
- 通常のDB一覧は trashed DB を表示しません。
- ゴミ箱画面に削除済みDBを表示します。
- 削除済みDBは復元できます。
- 完全削除は `databases-trash` API からのみ実行します。
- Private DB / Shared DB の両方に対応しています。

## 注意
完全削除時も backups フォルダへJSONを退避します。
