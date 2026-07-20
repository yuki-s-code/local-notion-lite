# v93 Global Search / Command Palette

## 目的
Cmd/Ctrl + K のコマンドパレットを、ページだけでなく Journal / Inbox / Database / 操作まで横断できる「アプリ全体の入口」に拡張しました。

## 追加内容
- ページ横断検索
- Journal検索
- Inbox検索
- Database検索
- 今日のJournal / Inbox / 新規ページ / 新規DB / 同期 / ゴミ箱のコマンド化
- コマンドパレットの2カラム化
- 操作ボタンをアイコン中心のクイックアクションに整理

## 方針
重い全文検索エンジンはまだ追加せず、既存のメモリ上データを使う軽量検索にしています。今後、データ量が増えてきたらSQLite FTSへ移行できます。
