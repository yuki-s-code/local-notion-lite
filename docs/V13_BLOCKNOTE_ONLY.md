# v13 BlockNote Only

v13 では安定ブロックエディタをUIから削除し、ページ本文の編集エンジンを BlockNote に一本化しました。

## 方針

- 本文編集は BlockNote のみ
- 既存の local-blocks 形式ページは読み込み時に BlockNote 形式へ変換
- 保存時は `kind: "blocknote"` として保存
- `content.md` は検索・履歴・差分確認用のMarkdownミラーとして維持

## 互換性

過去バージョンで作成した `local-blocks` ページは `localBlocksToBlockNote()` で自動変換されます。
