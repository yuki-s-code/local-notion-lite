# v285 Workspace Related Panel

## 目的

v284で追加したWorkspace Semantic Engineを、BlockNoteページのユーザー体験に接続するための右サイドバーを追加した。

Smart Assistの回答対象をいきなり拡張すると誤答リスクが上がるため、まずは「関連情報の提示」として安全にruri-v3を活用する。

## 追加ファイル

```txt
src/renderer/src/components/screens/WorkspaceRelatedPanel.tsx
```

## 変更ファイル

```txt
src/renderer/src/main.tsx
src/renderer/src/styles/app.css
```

## UI仕様

BlockNoteページ右側の既存ユーティリティレールに、以下の順番で表示する。

```txt
関連情報パネル
ページアウトライン
```

関連情報パネルは次のグループを持つ。

```txt
関連ページ
関連FAQ
関連DB
関連ジャーナル
関連資料
```

各グループは折りたたみ可能。折りたたみ状態はlocalStorageに保存する。

## API利用

ページ表示時に以下を呼び出す。

```txt
GET /semantic/related/page/:id?limit=32
```

Semantic Indexが未作成の場合、パネル内から以下を実行できる。

```txt
POST /semantic/reindex
```

## 保守性のための設計

- 関連情報UIは`WorkspaceRelatedPanel`に分離。
- `main.tsx`側には最小限の接続だけを追加。
- DB行・ジャーナル・FAQの関連表示にも流用できるよう、表示ロジックはSemanticChunkベースで実装。
- 検索/関連抽出ロジックはサーバー側のSemantic Engineに残し、renderer側にはスコア表示と遷移処理のみを持たせた。

## 今後の拡張候補

1. DB行詳細Drawerに`getRelatedForDatabaseRow()`を接続する。
2. ジャーナル画面に`getRelatedForJournal()`を接続する。
3. Smart Assistの補助根拠として、FAQ以外の関連チャンクを表示する。
4. 関連候補を「ページにリンクとして挿入」できるアクションを追加する。
5. 類似ページ/重複FAQの検出画面を追加する。
