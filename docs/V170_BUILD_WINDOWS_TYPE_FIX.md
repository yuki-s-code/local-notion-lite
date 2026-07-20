# V170 Build Windows Type Fix

GitHub Actions の build-windows で発生した TypeScript エラーを修正しました。

## 修正内容

- PageInfoPanel / CommandPalette へ api props を正しく渡すよう修正
- LinkPreviewDrawer の api 重複定義を削除
- PageStatus / PagePriority の入力値を型キャスト
- FAQ一覧 map の item 型を明示
- vaultService の rowId / relation cell 型を安全化
- better-sqlite3 の最小型宣言を追加

## 補足

このZIP作成環境では node_modules がないため `node` / `electron` 型定義エラーのみ残りますが、GitHub Actions 側では npm install 後に解決される想定です。
