# V778 Visual Web Builder Suite

Web Builderをコード専用画面から、ノーコードとコードを併用できる制作環境へ拡張しました。

## 追加機能
- コンポーネントライブラリ
- HTML Navigator
- Property / Visual CSS Editor
- Theme Manager
- Asset Manager（2MB/件、40件上限）
- Multi Page Manager
- 7種類の端末プレビュー
- ホバーアニメーション追加
- 最大30件の遅延履歴
- Accessibility / SEO / Performance / Responsive品質検査
- AI Web Designer（明示実行型）
- AI Inspector
- ページ・DBスナップショット管理
- 複数HTMLを含むZIP書き出し

## 効率設計
- NavigatorはHTML変更時のみuseMemoで再解析
- 品質検査はボタンを押した時だけ実行
- 履歴は1.4秒デバウンス、最大30件
- Autosaveは1.1秒デバウンス
- アセットに容量・件数上限
- 既存WebProjectをnormalizeWebProjectで自動移行
- ページ・DBタブやWorkspace状態を複製しない
