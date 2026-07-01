# V263 Database Row Preview Modern Fix

## 対応内容

### 1. 子ページ作成時の prompt() エラー修正

Electron 環境で `window.prompt()` がサポートされないため、DB行プレビューの子ページ作成で落ちていた問題を修正しました。

- `prompt()` を完全削除
- プレビュー内のインライン入力フォームで子ページ名を指定
- `/` メニューの「子ページを作成」ではデフォルト名で作成し、リンクを本文へ挿入

### 2. プレビューのプロパティ表示を復旧・明確化

V262 でリンク・子ページパネルを追加した影響でプロパティ領域が見えにくくなっていたため、Row Detail Drawer を再構成しました。

- ヘッダー
- ステータス/更新日カード
- ジャンプナビ
- プロパティカード
- 本文カード
- 逆引きRelationカード

の順で表示します。

### 3. プレビュー画面をモダン化

Notion 風のDB行ページに近づけるため、カード型レイアウトへ整理しました。

- sticky header
- property summary
- jump navigation
- modern cards
- inline child page creator
- clearer content/link section

## 非対象

- package-lock.json
- GitHub Actions
- kuromoji
- node-nlp
- DB保存APIの仕様変更
