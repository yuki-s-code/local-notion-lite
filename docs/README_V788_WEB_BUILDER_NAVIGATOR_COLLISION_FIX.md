# V788 Web Builder navigator name collision fix

## 修正内容

- Visual DOMの配列変数 `navigator` を `navigatorNodes` に改名
- ブラウザ標準の `navigator.clipboard` との名前衝突を解消
- コピー処理を `copyText()` に共通化
- Clipboard APIが利用できない場合は一時textareaによるコピーへフォールバック

## 解消したエラー

`Property 'clipboard' does not exist on type '{ id: string; tag: string; title: string; index: number; }[]'.`

WebBuilderScreen.tsx内の4箇所すべてを修正しています。

## 検証

- WebBuilderScreen.tsx TypeScript transpile diagnostics: 0
- プロジェクト全体のtypecheckは、作業環境に `electron` / `node` 型定義が存在しないため、その既存環境エラーのみ発生
