# v136 Local FAQ Chat

完全ローカル・Ollamaなしで、Notion AI風のFAQチャット基盤を追加。

## 追加機能

- Local Smart Assist内にFAQ Chatを追加
- ページ / DB / DB行 / Journal / Inbox / Taskを横断検索
- Fuse.js + 日本語トークン + 類義語 + 重要文抽出で根拠付き回答
- 自動FAQ候補を生成
- 回答に参照元ボタンを表示
- TODO抽出、Relation候補、未整理確認などのクイック質問

## 方針

生成AIではなく、ローカル情報から根拠を抽出して回答する方式。
クラウドAI・Ollama・外部通信は不要。

## 注意

自然文生成ではないため、最終判断は参照元を開いて確認する。
