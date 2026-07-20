# v289 Smart Assist Related Evidence Candidates

## 目的

Smart Assist の回答画面に、FAQ回答とは別枠で ruri-v3 / Workspace Semantic Engine の関連候補を表示する。

この機能は、回答を断定するための根拠ではなく、実務者が追加確認するためのナビゲーションとして扱う。

## 表示仕様

- 回答生成後、質問文を `GET /semantic/search` に渡して関連候補を取得する。
- API取得上限は24件。
- UI表示は上位8件。
- スコア38未満は表示しない。
- 対象種別は以下。

```txt
FAQ
ページ
DB行
Journal
資料要約
```

## 実務上の扱い

Smart Assist の本文回答は、従来どおり FAQ / 明示的な根拠を中心にする。

関連根拠候補は、以下の用途に限定する。

```txt
・追加確認
・関連資料への移動
・過去対応の発見
・似たページやDB行の確認
・FAQ回答の周辺情報確認
```

Journal や DB行は内部記録なので、回答の公式根拠としては扱わない。

## 保守性

今回の追加は `SmartAssistScreen.tsx` 内で、チャット回答の補助表示に限定している。

今後、関連候補カードを `WorkspaceRelatedPanel` とさらに共通化する場合は、表示専用の小コンポーネントに分離する。

