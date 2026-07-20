# V248 Database conflict detection / lock / DatabaseTable split

## 対応内容

### 1. DB保存時の競合検出

`WorkspaceDatabase` に `baseUpdatedAt` を追加し、`PUT /databases/:id` 保存時にサーバー側の現在値 `updatedAt` と比較するようにしました。

- 一致する場合: 保存を継続
- 不一致の場合: 保存を拒否し、再読み込みを促すエラーを返却
- 競合時: `conflicts/` 配下に incoming/current/meta のスナップショットを保存

これにより、他端末・別ウィンドウで更新されたDBを古い状態で上書きする事故を防ぎます。

### 2. database lock の追加

ページロックとは別に、データベース用ロックを追加しました。

追加API:

- `POST /databases/:id/lock`
- `DELETE /databases/:id/lock`

ロックファイルは既存の `locks/` 配下に `database_<id>.lock` として保存します。

Renderer側では、DBを開いた時に lock を取得し、取得できない場合は読み取り専用として開きます。

### 3. DatabaseTable UI の分離

`src/renderer/src/main.tsx` に集中していた DatabaseTable UI を以下へ分離しました。

- `src/renderer/src/components/DatabaseTable.tsx`

`main.tsx` は `DatabaseTable` を import して利用する形に変更しています。

## 非対象

以下は今回も触っていません。

- package-lock.json
- GitHub Actions の npm ci 化
- kuromoji

## 注意

この環境では `node_modules` / 型定義が未展開のため、完全な TypeScript チェックは実行できませんでした。`tsc` は `@types/node`, `electron`, `react` などの不足で停止します。

ただし、分離後に `DatabaseTable.tsx` の主要な未解決ローカル参照は確認し、`dbText`, `getActiveView`, `databaseCellText`, `getDateProperty`, `viewLabel` などの依存ヘルパーは同ファイル側に含めています。
