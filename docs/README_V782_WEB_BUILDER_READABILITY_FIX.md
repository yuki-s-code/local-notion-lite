# V782 Web Builder Readability Fix

## 修正内容

- 素材部品カードのお気に入りボタンを絶対配置から独立列へ変更
- タイトル・カテゴリとお気に入り操作の重なりを解消
- お気に入り状態をカード背景と星色でも識別可能に改善
- キーボードフォーカス表示と aria-label を追加
- 760px以下でも2列を維持し、430px以下で1列表示
- ヘッダー、コードタブ、プレビュー端末切替を文字を潰さずスクロール可能に変更
- インスペクター内の長い文字、共有部品コード、プラグイン名の折返しを改善
- ページ・DB連携一覧のタイトル省略と操作列固定を改善
- Web Builder内部に box-sizing を統一

## 検証

- WebBuilderScreen.tsx TypeScript transpile diagnostics: 0
- app.css braces validation: OK
- ZIP integrity test: OK
