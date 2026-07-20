# Tab導入後の初回起動遅延 — 全体監査結果

## 結論

Tab状態（`local-notion:workspace-workbench-v518`）の復元自体は、最大14件のID・ピン状態・表示名を`localStorage`から読むだけであり、全タブの本文・BlockNote・データベースを一括復元する構造ではありません。

初回起動を遅くしていた主因は、Tab関連のDB行子ページ対応と同時に入った、サイドバー・統合リンクIndexの全体走査です。

## 確認した主要ボトルネック

### 1. 初回`/pages/tree`で全DB行本文を走査

`VaultService.listPageTree()`のキャッシュがない、または無効な場合、`listDatabaseRowChildPageIdSet()`を呼びます。旧実装は全データベースを開き、全DB行の本文JSONを共有フォルダから列挙していました。

これはDB数 × DB行数のファイルアクセスになり、SMB共有フォルダでは特に遅くなります。TabでDB行の子ページを比較候補に扱うようになったことと関連する処理です。

### 2. 統合リンクIndexの初回再構築がUI要求を停止

`ensureUnifiedResourceLinkIndex()`はIndexバージョン不一致時に、全ページ、DB行コンテンツ、添付を再走査します。DB子ページの比較候補取得とDB行リンク表示がこれを`await`していたため、初回のIndex作成が画面操作をブロックしていました。

### 3. 起動時の共有フォルダ同期が二重に予約されていた

サーバー側（1.5秒後）とRenderer側（アイドル時）の両方で起動時同期を予約していました。実際の同期処理は共有Promiseで合流しますが、最初の描画中にサーバー側タイマーがI/Oを開始するため、低性能端末・共有フォルダで描画と競合します。

## 反映した修正

1. `listDatabaseRowChildPageIdSet()`をSQLiteの`pages.parent_id LIKE 'database-row:%'`だけで判定する方式に変更。
2. `listPageTree()`のキャッシュミス時も、DB行本文の全走査を行わないよう変更。
3. DB子ページ比較候補・DB行リンク表示は、統合Index再構築を待たず既存Indexを返す。Index再構築は非同期で継続。
4. サーバー側の起動同期タイマーを削除。Rendererのアイドル時同期だけを残し、起動直後のI/O競合を除去。

## Tabコンポーネント固有の確認結果

`WorkspaceWorkbench.tsx`の復元データは最大14タブ＋最近閉じた12件です。初期表示では現在ページのみをタブに登録し、保存済みの別タブを順番に`getPage()`する処理はありません。

ただし、現在タブがデータベースの場合は`DatabaseTable`を直接マウントするため、大規模DBを最初に開く場合は別の負荷があります。これはTab状態復元ではなくDBテーブル描画の負荷です。

## 残る推奨対応

- 統合リンクIndexの再構築はElectron起動から十分後のアイドル時、または設定画面の明示操作で実行する。
- 起動計測を`main`、API、Rendererに追加し、`BrowserWindow作成`、`初回tree`、`初回databases`、`共有同期`、`Index再構築`を別々にログ化する。
- `listDatabases()`がDB本体を全件ロードする構造なら、サイドバー用の軽量メタデータAPIへ分離する。
- `WorkspaceWorkbench`を`React.memo`化し、親`main.tsx`の状態変化による不要なタブ列再計算を減らす。
