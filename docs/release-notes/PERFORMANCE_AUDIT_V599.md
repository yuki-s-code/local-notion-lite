# v599 全体性能監査・初回改善

## 今回反映した修正

### 1. 起動直後の共有フォルダ同期を遅延開始
- 対象: `src/server/app.ts`
- 変更: API初期化完了から1.5秒後に共有フォルダ取込を開始。
- 目的: Electron初回描画、最初のページ一覧取得、SQLite接続と共有フォルダ走査が同時に競合することを避ける。
- 性質: 同期は自動のまま。手動同期APIの挙動は不変。

### 2. ページ保存時の全ページID走査を廃止
- 対象: `src/server/services/vaultService.ts` `upsertPageDerivedIndexes()`
- 旧挙動: 保存対象の本文を索引化するたび、`pages WHERE trashed = 0` の全IDを取得し、リンク先の存在確認に使っていた。
- 変更: 本文から抽出した参照IDだけを、最大800件ずつ `IN (...)` で問い合わせる。
- 効果: 通常のページ編集・自動保存におけるSQLite読み取り量とJavaScriptのSet構築量を、ワークスペース全体規模から「そのページに含まれるリンク数」へ縮小。

### 3. 旧式「📄 ページタイトル」互換リンクの正規表現総当たりを削減
- 対象: `src/server/services/vaultService.ts` `upsertPageDerivedIndexes()`
- 旧挙動: 全ページタイトルごとに正規表現を生成し、保存中の本文に照合。
- 変更: SQLite `instr()` で候補ページを先に絞り、候補だけ境界安全な正規表現で確認。
- 効果: ページ数が増えた際の保存遅延を抑制。

### 4. 共有フォルダ取込中のN+1 SQLite参照を削減
- 対象: `src/server/services/vaultService.ts` `importFromShared()`
- 旧挙動: ページディレクトリごとに `shared_page_file_state` を1回照会。
- 変更: 同期開始時に全シグネチャを1回読み込み、Mapで参照。
- 効果: 数千ページの共有フォルダでSQLite照会回数をページ数回から1回へ縮小。

### 5. `initVault()` の冗長なディレクトリ確認をプロセス内で一度に集約
- 対象: `src/server/services/vaultService.ts`
- 旧挙動: 多数のサービス入口で呼ばれるたび、複数ディレクトリのensureDir/pathExistsを繰り返す。
- 変更: 初回成功後はPromiseを再利用し、失敗時だけ次回再試行可能にした。
- 効果: ネットワーク共有フォルダ利用時の余計なファイルシステム往復を削減。

---

## 監査で確認した未修正の主要ボトルネック

### A. 分析同期は変更1件でも最大100,000行を全再構築
- 対象: `src/server/services/analysisNotebookService.ts` `sync()` / `replaceTable()`
- 現状: 件数または最大更新日時が変化すると、ページ・DB行・DB・Journal・Taskを再取得し、DuckDBテーブルを`CREATE OR REPLACE`して再投入する。
- 影響: 小さな修正でも大量テキストをJavaScriptでSQLリテラル化し、200行ごとのINSERTを繰り返す。共有フォルダ端末ではCPU・メモリ・ディスクI/Oが目立つ。
- 推奨: SQLite側の`id, updated_at, deleted`を同期状態テーブルに保存し、DuckDBへのUPSERT/DELETEを差分だけに限定する。全再構築は「分析キャッシュを再構築」操作だけにする。
- 優先度: 最優先。

### B. 分析画面が大きな結果をRendererへ全量転送・加工
- 対象: `src/renderer/src/components/screens/AnalysisNotebookScreen.tsx` の`hydrateResult()`、DataFrame/ピボット/集計/前処理の実行経路
- 現状: 結果が複数ページにまたがると`getAnalysisResultAll()`で全量取得してから、Renderer側JavaScriptで`filter/sort/map/JSON.stringify`などを実行する。
- 影響: 表示DOMを仮想化しても、10万行の配列生成・複製・集計でUIスレッドが停止する。
- 推奨: DataFrame、結合、ピボット、統計、品質確認、前処理をDuckDBの一時テーブルまたはサーバー処理へ移す。Rendererへは表示中のページ、グラフ用の集計済みデータ、メタ情報だけ返す。
- 優先度: 最優先。

### C. 分析ノート一覧で巨大JSONをすべて復元
- 対象: `analysisNotebookService.ts` `listNotebooks()`
- 現状: 一覧表示でも`cells_json`、`execution_history_json`、`snapshots_json`を全件読み取り、JSON.parseしている。
- 影響: 分析ノートやスナップショットが増えるほど、画面を開くだけでメモリとCPUを消費する。
- 推奨: 一覧APIはID、タイトル、説明、作成・更新日時、セル数だけ返す。選択したノートだけ詳細APIで完全復元する。
- 優先度: 高。

### D. 分析画面の親コンポーネントが肥大化
- 対象: `AnalysisNotebookScreen.tsx`（約225KB）
- 現状: セル編集、結果、選択状態、履歴、サイドバー、グラフ設定が単一コンポーネントのstateに集中。1セル入力でも他セルの描画関数・派生値が再評価されやすい。
- 推奨: `AnalysisCellView`、`AnalysisSidebar`、`AnalysisResultPanel`を分割し、セル単位で`React.memo`、安定したcallback、selectorを採用する。セル数が多い場合はセル自体の仮想化も行う。
- 優先度: 高。

### E. DB行リンク索引では、現在も全ページIDを読み込む
- 対象: `vaultService.ts` `upsertDatabaseRowLinkIndex()`
- 現状: DB行本文のリンク索引更新で`SELECT id FROM pages WHERE trashed = 0`を実行している。
- 推奨: 今回ページ保存側に反映した「参照されたページIDだけを問い合わせる」方式をDB行側にも適用する。
- 優先度: 高。

### F. `rebuildWorkspaceDerivedIndexes()` は完全再索引
- 対象: `vaultService.ts`
- 現状: 全ページを`getPage()`で再読込し、DB行本文・添付も順次再走査。
- 推奨: 明示的メンテナンス操作または索引形式移行時だけに限定する。実行時は進捗・キャンセル・低優先度キューを持たせる。
- 優先度: 中。

### G. 一覧系APIが全件返却する設計
- 対象: `/pages`、一部のデータベース/添付/履歴一覧
- 現状: ページ一覧は全件メタデータを返し、既定で全ロック状態も読む。
- 推奨: tree用の軽量DTO、検索用ページングDTO、詳細DTOを分離する。ロック情報は表示中/可視範囲だけ取得する。
- 優先度: 中。

---

## 推奨する次の実装順

1. 分析処理をRendererからDuckDBサービスへ移管する。
2. DuckDB同期を全再構築から差分同期へ変更する。
3. 分析ノートの一覧DTOと詳細DTOを分離する。
4. DB行リンク索引の全ページ走査を今回と同じ方式で廃止する。
5. 分析セルを独立コンポーネント化し、セル単位の再描画にする。
6. ページ一覧・ロック取得・添付一覧のAPIをページング化する。

## 検証

- 変更済みTypeScriptファイルはTypeScriptの構文変換でエラーなし。
- このZIPには`node_modules`が含まれないため、依存型を含めた`npm run typecheck`・ビルド・Electron実行はこの環境では実施できない。
