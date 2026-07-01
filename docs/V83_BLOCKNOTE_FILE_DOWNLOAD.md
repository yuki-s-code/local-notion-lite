# V83 BlockNote File Download Fix

BlockNote標準のファイルブロックで「ファイルをダウンロード」をクリックした時に、Electronの新規ウィンドウ抑止処理でURLが握りつぶされていた問題を修正しました。

## 方針

- 独自ファイル添付UIは使わない
- BlockNote標準のFile/Image/Video/Audioブロックを使う
- `uploadFile` は共有フォルダ `attachments` へ保存して表示URLを返す
- BlockNoteがファイルURLを開こうとしたら、Electron main process 側で `downloadURL()` に変換する
- `/file` URL は `?download=1` を付けて `Content-Disposition: attachment` にする

これにより、Hover時の標準「ファイルをダウンロード」から実際にダウンロードできます。
