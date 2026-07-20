# v601 DB Semantic Index / 関連情報 監査

## 発生していた事象
DB行の本文またはテーブル上のセルを更新しても、行詳細の「関連情報」に以下が残る。

- このページはまだSemantic Indexに反映されていません。
- 関連ページを準備中です。Semantic Indexの差分更新または再構築が完了すると、自動で候補を表示します。

## 根本原因

### 1. DB行の保存経路がSemantic差分更新へ接続されていなかった
ページ本文の保存後は `main.tsx` の `scheduleSemanticIndexUpdateForPage()` が、6秒の入力待機後に対象ページを優先して `/semantic/diff-update` へ送る。

一方、DB行本文の保存は `DatabaseRowContentEditor.tsx` で以下までしか行っていなかった。

- DB行本文の保存
- DB行リンクIndex更新
- DB行タスクIndex更新
- リンク表示更新

Semantic Index の更新予約がなく、既存Indexに当該行がない場合は永久に `target: null` のままとなる。

### 2. DB表セルの保存もページ専用の差分更新対象外だった
`saveDatabase()`、`addDatabaseRow()`、埋込DBの保存ではDBの通常Indexは更新されるが、Semantic Indexには変更通知が届かない。

Semantic本文のハッシュはセル値を含んでいるため、差分Index自体はセル更新を検出できる。しかし差分Indexを開始しないため、検出する機会がなかった。

### 3. 未反映メッセージが二重表示されていた
サーバーが「未反映」をwarningとして返し、Rendererも `target === null` の一般メッセージを追加表示していた。

## v601 修正

### 共通のSemantic更新予約
`main.tsx` に、ページだけでなく任意のSemanticソースを扱える共通キューを追加。

- キー: 関連パネルと一致する `targetKey`
- 優先Chunk: `page:<pageId>` / `database_row:<databaseId>:<rowId>`
- 6秒の操作待機
- 編集中は最大10秒の静穏時間を待機
- 失敗時は15秒後に再試行
- 対象を最大20件の差分更新で優先処理

### DB行本文
`DatabaseRowContentEditor` が保存確定後に次のイベントを送る。

```text
local-notion:semantic-refresh-request
 targetKey: database_row:<databaseId>:<rowId>
 preferredChunkId: database_row:<databaseId>:<rowId>
```

このため、本文変更はリンクIndex/タスクIndexと同じ保存確定タイミングでSemantic差分更新にも入る。

### DB表セルと行追加
保存成功後、保存前後の行を比較して変更行・新規行を最大16件検出し、それぞれを優先更新としてキューに登録する。

- セル値変更
- 行更新日時変更
- 行追加

プロパティ定義だけを変更したケースは、内容に影響する行が通常の差分更新で検出される。大規模DBで全行を即時Embeddingしないため、操作を止めない。

### 表示の二重警告除去
サーバーwarningがある場合、Rendererの「関連ページを準備中」一般警告は表示しない。

## 動作仕様

1. Semantic Indexが既に存在する
   - DB本文・セル保存後、約6秒の操作待機を経て対象行を優先差分更新
   - 成功イベントで関連情報を自動再取得
   - `target: null` 表示は解消される

2. Semantic Indexが未作成
   - 自動で全件Embeddingは開始しない
   - 一度だけ管理画面または関連情報の「Semantic Indexを作成」を実行する必要がある
   - これは日常のDB編集で初回全件Index生成が始まり、アプリが固まることを防ぐため

3. Embeddingモデル失敗・ローカルキャッシュ不在
   - 更新は再試行キューへ戻る
   - 管理画面のWorkspace Semantic Index診断でモデル・キャッシュ・更新履歴を確認する

## 監査した関連経路

- `DatabaseRowContentEditor.save()`
- `VaultService.saveDatabaseRowContent()`
- `DatabaseWorkspaceService.saveDatabase()` 呼び出し経路
- `main.tsx` のDB保存キュー、埋込DB保存、行追加
- `collectWorkspaceSemanticChunks()` のDB行chunk生成
- `SemanticIndexService.buildIndex()` のpreferredChunkIds優先制御
- `getWorkspaceSemanticRelated()` の対象行解決
- `WorkspaceRelatedPanel` のdirty/index-updatedイベントとキャッシュ無効化

## 残る性能上の注意

- `collectWorkspaceSemanticChunks()` は差分更新でも全ページ・全DB行・全Journalを収集する。Embeddingは差分だけだが、巨大ワークスペースでは収集I/Oが残る。
- 次段階では、DB行・ページ・Journalの「単一ソースchunk生成」を追加し、優先更新時は全ワークスペース収集を避けるべき。
- Relation/Rollupが大量にあるDBは `databaseRowSemanticPayload()` の計算量が大きくなり得るため、依存DBを含むプロパティ計算キャッシュが有効。
