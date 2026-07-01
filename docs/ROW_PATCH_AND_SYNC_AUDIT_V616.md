# V616 — DB行単位保存・同期経路監査

## 今回の対象

通常のテーブル編集（1セル編集、同一DB内の双方向Relation編集、複数セル貼り付け）を、DB全体のPUT保存ではなく、行単位PATCHに切り替えた。

## 追加した経路

`DatabaseTable` → `main.tsx` のDB行パッチキュー → `PATCH /databases/:id/rows` → `VaultService.patchDatabaseRowsCore()` → `saveDatabaseFile(... changedRowIds)`

- Rendererでは変更した行とセルだけを500msでまとめる。
- 同じ行に連続して入力した場合、最後のセル値だけを送る。
- 複数セル貼り付けは、最大2,000セルの既存制限を維持し、更新対象行を1つのPATCHにまとめる。
- 同一DB内の双方向Relationで複数行が変わる場合も、1つのPATCHとして同時に保存する。
- サーバーでは対象行だけを更新し、SQLiteの`database_row_index`、`database_row_property_index`、FTS、行ハッシュを対象行だけ再生成する。
- Semantic Index通知はサーバーが実際に変更した行だけに送る。

## 効率面

従来の通常セル編集は、RendererからDB全体（`rows`, `properties`, `views` を含む）をPUTし、サーバーで全行を比較する経路だった。

今回から通常セル編集は、`rowId + 変更セル`だけを送る。JSONファイルを共有フォルダに保存する現行アーキテクチャ上、サーバーは安全な原子書込みのためDB JSON全体を読み書きする。ただし次を削減する。

1. Renderer→Serverの巨大なDBペイロード
2. Renderer側の全行差分判定
3. サーバー側の全行ハッシュ比較
4. 非変更行のSQLite Index再生成
5. 非変更行へのSemantic Index更新要求

## 整合性

- `baseUpdatedAt` を使う楽観的競合検出をPATCHにも適用した。
- 競合時は既存のDB保存と同じ`DATABASE_CONFLICT`を返す。
- Unique ID、Formula、Rollup、Created/Last edited timeはPATCHで書き換え不可にした。
- スキーマ変更、行追加・削除、行順変更、ビュー変更は従来どおりDB全体保存を使用する。

## 残課題

1. JSONファイルをDB全体で永続化しているため、完全なO(1)書込みにはSQLite/行別ファイルへの移行が必要。
2. 同期処理（起動時、定期、保存後、手動）の単一コーディネータ化は未実施。
3. サブアイテム使用時のServer Tableは、親子順のサーバーページング未実装のため従来どおり無効化される。
4. Undo/Redoは現在のDB全体スナップショット方式であり、行PATCHのローカル履歴は保持するが、Undo操作そのものは全体保存として安全に反映する。

## 検証

変更ファイルをTypeScriptの`transpileModule`で構文変換し、構文診断なしを確認した。プロジェクト全体の`tsc --noEmit`は、添付ZIPに`electron`と`node`の型定義が含まれていないため、依存型解決の段階で停止した。
