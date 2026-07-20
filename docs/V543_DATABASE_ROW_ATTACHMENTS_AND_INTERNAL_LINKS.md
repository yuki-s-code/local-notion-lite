# V543 DB行添付と内部リンク

- DB行本文へ通常ページと同様の添付アップロードを追加。
- 添付は scope ごとに `attachments/database-rows/<databaseId>/<rowId>` に保存。
- BlockNoteの安定URL化と再起動後のlocalhost URL再解決にDB行添付を追加。
- `#local-page` / `#local-dbrow` / `#local-database` を外部URLより先に解決し、@リンクがブラウザを起動しないよう統一。
