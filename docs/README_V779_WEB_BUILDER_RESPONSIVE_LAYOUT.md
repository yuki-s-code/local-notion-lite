# V779 Web Builder Responsive Layout

## 概要

Web Builder のレイアウトを viewport 基準の media query から、Web Builder 自身の実幅を基準にする container query へ移行しました。

## 主な変更

- 大画面: プロジェクト / インスペクター / コード / プレビューの4ペイン
- 中画面: 編集・分割・サイト表示の切替
- 小画面: 縦方向の一画面集中UI
- DockViewやアプリサイドバーで幅が変化しても追従
- ヘッダー、端末切替、書き出し操作の横スクロール対応
- サイドバー・インスペクター非表示時の残り幅再配分
- プレビューとコードエディターの最小幅・最小高さを整理
- モバイルではリンク挿入・コンソール・ツールバーを縦配置

## 状態管理

追加した `responsiveView` は画面表示だけを管理し、プロジェクトデータへ保存しません。

- `editor`: コード中心
- `split`: コードとプレビュー
- `preview`: プレビュー中心

ページ、データベース、HTML、CSS、JavaScript、履歴等の既存保存形式は変更していません。

## 検証

- WebBuilderScreen.tsx transpile diagnostics: 0
- npm run check:styles: passed
