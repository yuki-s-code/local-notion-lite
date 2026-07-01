# v95 Task Processing

Task Hubを一覧表示だけでなく、その場で処理できるようにしました。

## 追加内容

- タスク完了/未完了の切替
- 期限を今日/明日に設定
- date inputによる期限変更
- タスク検索
- 元ページ/Journal/Inboxへ戻る導線

## 実装方針

タスクはページ・Journal・InboxのMarkdownから抽出します。
Task Hubで変更した場合は、元のMarkdown行を更新します。

対応形式:

```md
- [ ] タスク本文
- [x] 完了済みタスク
- [ ] 期限付きタスク due: 2026-06-30
```
