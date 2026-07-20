# v141 FAQ JSON Import Modal Fix

## 修正内容

- `prompt()` を使っていたFAQ JSON取込を廃止。
- Electron環境でも動くモーダル + テキストエリア方式に変更。
- JSON取込エラーを画面内に表示。
- JSON出力はクリップボードコピーを優先し、失敗時はJSONファイルとしてダウンロードする方式に変更。
- 最終フォールバックでも `prompt()` を使わず、同じモーダルにJSONを表示。

## 対応したエラー

```txt
main.tsx:4250 Uncaught (in promise) Error: prompt() is not supported.
```
