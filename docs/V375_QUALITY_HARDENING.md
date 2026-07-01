# V375 品質・耐障害性強化

- `DatabaseLockService` に `node:os` import を追加し、DBロック取得時の実行エラーを修正。
- 巨大な履歴差分でLCSの `O(m × n)` メモリ使用量が暴走しないよう、100万セルを上限として要約表示へフォールバック。
- Workspace Semantic Index を同一フォルダ内の一時ファイル経由で原子的に置換。
- ページコメントを原子的に保存し、同一アプリ内でのコメント追加・編集・削除をページ単位で直列化。
- GitHub Actions の依存インストールを `npm ci --legacy-peer-deps` に変更。`package-lock.json` を必ずコミットして利用すること。

## 未対応

共有フォルダ上で複数端末が同時にロックを新規作成する競合と、ページ3ファイルのcommit marker化は次段階（V376）の対象です。
