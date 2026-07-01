# v84 BlockNote File Cards

- BlockNote標準の File / Image / Video / Audio ブロックを維持。
- 独自ファイル添付UIは追加しない。
- `uploadFile` が返すURLに元ファイル名を含め、拡張子からカードの雰囲気を変える。
- PDF / 画像 / 動画 / 音声 / Office / ZIP / その他で控えめにアイコンと背景を切り替える。
- ダウンロードは従来どおりElectron側で添付URLを検知して `downloadURL` に渡す。
