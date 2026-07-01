# v34 BlockNote link schema fix

## 修正内容

- v33で使用していた `styles.link` を廃止。
- BlockNote標準のリンクInlineContent形式 `{ type: "link", href, content }` に変更。
- 既存の `styles.link` データは読み込み時に自動変換。
- `@ @[[タイトル|page_id]]` などの壊れた旧形式も読み込み時に正規化。
- 初期コンテンツをBlockNoteへ渡す前に、未知のstyleを除去。

## 理由

BlockNoteの標準styleSchemaには `link` styleが存在しないため、`styles: { link: ... }` を含む初期データを渡すと `style link not found in styleSchema` でクラッシュします。
