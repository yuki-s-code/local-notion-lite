# v323 Workspace AI Search

## 目的

v321/v322で拡張したWorkspace Semantic SQLite Cacheを、ユーザーが直接使える横断検索UIとして提供する。

## 追加内容

- 右下に `AI検索` フローティングボタンを追加
- 右サイドにWorkspace AI Searchパネルを追加
- `Cmd/Ctrl + Shift + K` でAI横断検索を起動
- Command Paletteに `AI横断検索` 操作を追加
- Smart Assist管理画面に `AI横断検索` タブを追加
- FAQ / ページ / DB行 / Journal / 資料を種類別カードで表示
- Semantic score / lexical score / reasons を表示
- 結果クリックで対象を開く
  - page: ページを開く
  - journal: Journalを開く
  - database_row: DB行を開く
  - attachment_summary: 親ページを開く

## 設計方針

既存のFAQチャット回答ロジックは変更せず、関連資料を探すためのWorkspace検索として独立させた。

- FAQチャット: 業務回答用
- Workspace AI Search: 関連資料・ページ・DB行・Journal探索用

## 使用するAPI

- `GET /semantic/search?q=...&limit=...&types=...`

## 操作入口

1. 右下AIフローティングボタン
2. `Cmd/Ctrl + Shift + K`
3. Command Palette内の `AI横断検索`
4. Smart Assist管理画面の `AI横断検索` タブ
