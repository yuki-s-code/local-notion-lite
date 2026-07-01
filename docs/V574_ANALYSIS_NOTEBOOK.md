# V574 分析ノートブック（DuckDB + Arquero + Observable Plot）

## 目的

アプリ内のページ、データベース、Journal、タスクを横断し、JupyterLabに近い「SQL + 表 + グラフ + メモ」を保存できる分析ワークスペースを追加する。

## 構成

- `@duckdb/node-api`：端末ローカルの分析用DuckDBキャッシュ
- `arquero`：SQL結果のブラウザ側整形・数値グラフ用の軽量変換
- `@observablehq/plot`：棒・折れ線・散布図
- `analysis_notebooks`：ノート本文・SQL・グラフ設定を端末側SQLiteへ保存

## 安全性

- 共有フォルダの正本データへSQLで書き込まない。
- 分析SQLは `SELECT` / `WITH` / `EXPLAIN` 相当の読み取り専用に限定し、書込み・拡張機能・ファイル操作を拒否する。
- SQLは1文だけ。結果は最大10,000行。
- DuckDBのDBファイルは通常のローカルSQLiteキャッシュと同じ端末側フォルダに `analysis.duckdb` として保存する。

## 分析用テーブル

| テーブル | 内容 |
|---|---|
| `pages` | 通常ページ・プロパティ・本文（先頭60,000文字） |
| `databases` | DB定義、ビュー、プロパティ情報 |
| `database_rows` | DB行、セルJSON、検索テキスト |
| `journals` | Journal全文（先頭60,000文字）、タグ、気分、天気 |
| `tasks` | ページ、Journal、Inboxから抽出したタスク |

## 使い方

1. サイドバーの `📊` から「分析ノートブック」を開く。
2. 最初に `データを同期` を実行。
3. SQLセルへ読み取りSQLを入力して `実行`。
4. 表・棒グラフ・折れ線・散布図を選ぶ。
5. `保存` で分析ノートを端末へ保存。`CSV出力` で結果をダウンロード。

## インストール後の確認

依存関係を追加したため、lockfile作成後に次を実行する。

```bash
npm install
npm run typecheck
npm run test
npm run build
```

DuckDB Node Neoはプラットフォーム別の事前ビルドをoptional dependencyとして配布する方式である。Windows x64とmacOS arm64では、実機で分析画面を開いて「データを同期」「SQL実行」「CSV出力」を必ず確認する。
