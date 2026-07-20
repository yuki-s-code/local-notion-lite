# v154 FAQ Stats Initialization Fix

## 修正内容

- LocalSmartAssistView で `faqStats` を初期化前に参照していた問題を修正。
- `recommendedQuestions` より前に `faqStats` / `faqKnowledgeBase` を計算するように順序を変更。
- React 初期レンダー時の `Cannot access 'faqStats' before initialization` を解消。

## 影響範囲

- AIホームカード
- おすすめ質問
- FAQライブラリ
- FAQナレッジベース

機能ロジックやレイアウトは変更していません。
