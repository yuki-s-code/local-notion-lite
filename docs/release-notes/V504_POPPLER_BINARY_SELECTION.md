# v504 PDF文字抽出（Poppler）実行ファイル選択

## 追加内容

設定画面の「PDF文字抽出（Poppler）」から `pdftotext.exe`（macOS/Linuxでは `pdftotext`）を選択できます。

選択した実行ファイルと同じフォルダにある `pdfinfo` と `pdftoppm` を自動で使用します。

- `pdftotext`: 文字PDFの本文抽出
- `pdfinfo`: ページ数の取得
- `pdftoppm`: スキャンPDFを画像化してOCRするために使用

## 保存先

設定はこのPCのElectron設定に保存されます。共有フォルダやページ本文には保存されません。

## 探索順

1. ユーザーが選択した `pdftotext`
2. アプリ同梱の Poppler
3. OSのPATH

同じフォルダに `pdfinfo` と `pdftoppm` がない場合は設定を受け付けません。
