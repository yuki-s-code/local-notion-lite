# V781 Non-AI Authoring UX

AI呼び出しを増やさず、制作体験を改善しました。

- Command Palette（Cmd/Ctrl+K）
- コンポーネントのお気に入り
- ユーザーテンプレート
- Visual DOMの状態表示
- プレビュー直接編集
- Smart Auto Layout
- Micro Animation
- Plugin Runtime
- 履歴からの復元とレイアウト操作
- 後方互換のプロジェクト正規化

## 効率性

- プラグインはcompilerで一度だけ合成
- 保存・プレビュー・履歴の既存デバウンスを維持
- 新規項目はnormalize時にだけ補完
- resize監視、polling、常時解析を追加しない
