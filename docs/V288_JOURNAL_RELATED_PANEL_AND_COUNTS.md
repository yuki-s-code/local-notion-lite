# v288 Journal Related Panel and Related Count Clarity

## 目的

v287でページ・DB行詳細に表示していた ruri-v3 関連情報パネルを、Journal 画面にも接続した。
また、関連候補が何件表示されるのかをUI上で分かるようにした。

## 表示件数

- API取得: 最大32件
- サーバー側の種別グループ化: 各種別 上位8件
- UI初期表示: 各種別 上位4件
- 「さらに表示」クリック後: 各種別 上位8件まで表示

対象種別は以下。

- 関連ページ
- 関連FAQ
- 関連DB
- 関連ジャーナル
- 関連資料

## Journal画面での変更

Journal右側タブに「関連情報」を追加した。

- 関連情報
- 今日の動き
- レビュー
- 履歴

Journalの関連情報では、その日付のJournal本文・タイトルを起点に、ページ・FAQ・DB行・過去Journalを横断して近い情報を表示する。

## 保守性

関連情報UIは引き続き `WorkspaceRelatedPanel` に集約している。
ページ、DB行、Journalで同じコンポーネントを使うため、今後のUI改善・件数変更・スコア表示変更は一箇所で調整できる。

主な変更ファイル:

- `src/renderer/src/components/screens/WorkspaceRelatedPanel.tsx`
- `src/renderer/src/main.tsx`
- `src/renderer/src/styles/app.css`

## 実務上の位置付け

関連表示は、正解を断定する回答機能ではなく、実務者が関連資料・類似案件・過去対応を素早く見つけるためのナビゲーションである。
そのため、FAQや公式資料を強く、JournalやDB行を補助情報として扱う運用が望ましい。
