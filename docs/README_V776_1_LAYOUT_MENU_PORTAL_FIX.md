# V776.1 — Workspace配置メニュー表示修正

- Workspaceタブバーの `overflow: hidden` による配置メニューの切り取りを修正。
- 配置メニューを `createPortal(..., document.body)` で表示。
- トリガーボタン位置からfixed座標を計算。
- ウィンドウサイズ変更、スクロール時に位置を再計算。
- 外側クリックで閉じる判定をPortal側にも対応。
- 画面高さを超える場合はメニュー内スクロール。
