# v731 用語タブのカード化・未登録用語候補

## 変更内容

- 右パネルの「用語」タブをカード型に整理。
- 登録済み用語カードに、定義・分類・一致表記・別名数・補足資料数・確認状態を表示。
- ページ本文だけを軽く解析し、未登録かもしれない用語候補を表示。
- 候補カードから「用語として作成」を押すと、用語辞書画面を開き、正式名称に候補語を入れた新規下書きを作成。
- 常時処理は増やさず、用語タブを開いた時だけ `useMemo` で解析。

## 効率面

- ワークスペース全体の候補抽出APIは使わず、現在ページのMarkdown最大50,000文字だけを対象にした。
- 登録済み用語照合は既存の `compileGlossary()` を利用。
- 未登録候補は最大8件、登録済み用語カードは最大18件に制限。
- 右パネルを閉じている時はマウントされないため、通常編集時の負荷は増えない。

## 変更ファイル

- `src/renderer/src/components/screens/PageGlossaryPanel.tsx`
- `src/renderer/src/components/screens/GlossaryManagerScreen.tsx`
- `src/renderer/src/main.tsx`
- `src/renderer/src/styles/app.css`

## 確認

- CSSチェック OK
- `PageGlossaryPanel.tsx` esbuild 構文確認 OK
- `main.tsx` esbuild 構文確認 OK
- `src` 配下の生成済み `.js` なし
