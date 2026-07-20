# v723 minimap polish

- 現在位置ビューを青系からニュートラルな半透明ガラス枠へ変更し、本文線と色が混ざらないように調整。
- ビュー枠の左右に控えめなレールを追加し、半透明でも現在位置が判別しやすいように調整。
- ミニマップ本文線の高さ・opacity・表示セグメント数を抑制し、行の重なりを減らした。
- 見出し線も太すぎないように調整し、VS Code風の細い密度表示に寄せた。

Verification:
- node scripts/check-styles.mjs: OK
- src/**/*.js: 0 files

Note:
- node_modules がないため npm run typecheck / npm run build は未実行。
