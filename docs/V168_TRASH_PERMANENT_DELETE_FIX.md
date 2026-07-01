# V168 Trash Permanent Delete Fix

## 修正内容

Private / Shared 分離後、ゴミ箱の完全削除が保存先を正しく見に行けないケースを修正しました。

- Shared pages と Private pages の両方を削除候補として確認
- 完全削除前バックアップに shared/private の区別を保持
- `ゴミ箱を空にする` で失敗した件数を内部的に検出
- Privateページを再起動後に削除できない問題を防止

## 方針

ページの正本は `scope` により shared/private に分かれますが、完全削除では安全のため両方の保存先候補を探索します。
