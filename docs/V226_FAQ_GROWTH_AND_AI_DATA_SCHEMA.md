# v226 FAQ Growth Studio and AI Data Schema

## 目的

- 「FAQを育てる」画面からJSON取込/出力の重複導線を撤去。
- JSON/CSVの入出力は「AIデータ」タブへ集約。
- AIデータ管理画面で、各データの用途・JSON構造・CSV列・サンプルを表示。
- FAQ改善画面を、未回答・低信頼・フィードバックからFAQを育てるためのモダンな画面に整理。

## 変更点

- FAQ Builderヘッダーから `JSON取込` / `JSON出力` を削除。
- FAQ Builderに `AIデータ管理へ` の導線を追加。
- `aiDataLabels` に `jsonShape` / `sample` / `whenToUse` を追加。
- AIデータカードを説明・構造・サンプル付きのカードUIへ変更。
- JSON取込モーダルのプレースホルダーを対象データ別サンプルへ変更。

## 運用方針

- FAQを個別に改善する: 「FAQを育てる」
- JSON/CSVで一括管理する: 「AIデータ」
- 日常操作: 「運用」
