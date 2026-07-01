# V266 Trash date and database sidebar live fix

## 対応内容

- `main.tsx` に残っていた `formatTrashDate` 参照の未定義エラーを修正。
- ゴミ箱サイドバーでページ・DBを削除/復元しようとした際に App 全体が落ちないようにした。
- データベースツリーをページツリーに近いリアルタイム表示へ改善。
  - DBタイトル、行タイトル、行数、更新日時、主要セル値の変化を検知。
  - 展開中のDB行一覧を自動再取得。
  - 「さらに表示」で取得済みの件数は可能な範囲で維持。
- DB行子ページ作成後にサイドバーとページツリーの情報を再読み込みするようにした。

## 非対象

- package-lock.json
- GitHub Actions
- kuromoji / node-nlp
- DB保存仕様の大幅変更
