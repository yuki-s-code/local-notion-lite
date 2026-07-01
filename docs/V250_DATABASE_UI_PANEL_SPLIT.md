# V250 Database UI Panel Split

## 目的
V249で `DatabaseTable.tsx` から行・セル・ビュー系を分離したため、V250ではさらに周辺UIを分離し、DBテーブル本体の責務を軽くした。

## 変更内容

### 追加ファイル

- `src/renderer/src/components/database/DatabaseToolbar.tsx`
  - DBタイトル、主要操作、インサイトカード、Large DB / SQLite Server Engine表示、ビュータブ、検索ボックスを担当。

- `src/renderer/src/components/database/DatabaseSchemaPanel.tsx`
  - Propertiesパネルを担当。
  - プロパティ追加、型変更、表示/非表示、Relation/Rollup/Formula設定、選択肢編集を担当。

- `src/renderer/src/components/database/DatabaseViewSettingsPanel.tsx`
  - View設定パネルを担当。
  - ビュー名、ビュー種別、フィルター、ソート、表示設定を担当。

- `src/renderer/src/components/database/DatabaseServerPagingControls.tsx`
  - Server Table利用時のページングUIを担当。

- `src/renderer/src/components/database/DatabaseRowDetailDrawer.tsx`
  - 選択行の詳細ドロワーを担当。
  - Relationリンクと逆引きRelation表示も含む。

- `src/renderer/src/components/database/DatabaseAnalysisPanel.tsx`
  - DB分析パネルを担当。

### 既存修正

- `src/renderer/src/components/DatabaseTable.tsx`
  - 上記コンポーネントを呼び出す形へ整理。
  - テーブル本体、状態管理、保存反映、表示モード切替の統括に寄せた。

- `src/renderer/src/components/database/DatabaseHelpers.ts`
  - `RelationBacklink` 型を export。
  - `coerceDatabaseCellValue` を `DatabaseTable.tsx` 側で明示 import。

## 非対象

- package-lock.json 追加
- GitHub Actions の npm ci 化
- kuromoji 導入
- DBスキーマ変更
- API仕様変更

## 確認

`node_modules` が未展開のため完全なTypeScriptチェックはできないが、React型不足を除いたローカル参照の不足は確認・修正した。
