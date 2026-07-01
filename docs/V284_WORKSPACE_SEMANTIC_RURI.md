# V284 Workspace Semantic Engine / ruri-v3

## 目的

Smart Assist だけで使っていた ruri-v3 / Transformers.js の意味検索を、アプリ全体の共通知識レイヤーに昇格した。

対象は次の通り。

- FAQ
- BlockNote ページ本文
- データベース行
- ジャーナル

これにより、FAQ回答だけでなく、ページ・DB行・ジャーナルを開いたときの「関連情報」抽出に利用できる。

## 追加したサーバー構成

```txt
src/server/services/semantic/
  semanticTypes.ts
  semanticIndexService.ts
```

### semanticTypes.ts

共通チャンク形式を定義する。

```ts
type SemanticDocumentType = 'faq' | 'page' | 'database_row' | 'journal' | 'attachment_summary';
```

FAQ、ページ、DB行、ジャーナルを `SemanticChunk` に正規化して扱う。

### semanticIndexService.ts

- ruri-v3 による embedding
- workspace-semantic-index.json の保存/読込
- 意味検索 + 文字一致のスコア統合
- 関連情報のグループ化

を担当する。

## 追加した VaultService メソッド

```ts
collectWorkspaceSemanticChunks()
rebuildWorkspaceSemanticIndex()
getWorkspaceSemanticIndexInfo()
searchWorkspaceSemantic(query, options)
getWorkspaceSemanticRelated(input)
```

## 追加API

```txt
GET  /semantic/index
POST /semantic/reindex
GET  /semantic/search?q=...
GET  /semantic/related/page/:id
GET  /semantic/related/faq/:id
GET  /semantic/related/journal/:date
GET  /semantic/related/database/:databaseId/row/:rowId
```

## 保存先

```txt
<sharedRoot>/smart-assist/workspace-semantic-index.json
```

現時点では既存の smart-assist 配下に保存している。将来的には `semantic/` 専用ディレクトリへ移してもよい。

## 実装方針

いきなり Smart Assist の回答対象を広げると誤答リスクが上がるため、まずは「関連情報表示」に使う。

推奨順序は次の通り。

1. `/semantic/reindex` で全体インデックスを作成
2. ページ右サイドバーで `/semantic/related/page/:id` を表示
3. DB行詳細で `/semantic/related/database/:databaseId/row/:rowId` を表示
4. ジャーナル画面で `/semantic/related/journal/:date` を表示
5. 十分に動作確認してから Smart Assist の補助根拠として統合

## 注意点

- ruri-v3 モデルと WASM が未配置の場合、インデックス作成は `available=false` になる。
- 既存の Smart Assist FAQ回答ロジックは変更していない。
- 関連抽出は「候補表示」用途であり、回答の根拠として断定利用するのは次フェーズにする。
