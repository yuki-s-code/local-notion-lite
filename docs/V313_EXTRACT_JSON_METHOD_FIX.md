# V313 extractJsonObjectFromText method fix

## 修正内容

- FAQ改善案生成時に `this.extractJsonObjectFromText is not a function` が出る問題を修正。
- `VaultService` クラス内に `extractJsonObjectFromText(text)` を追加。
- llama.cpp / llama-completion の出力に含まれる以下を処理可能にした。
  - ```json ... ``` コードブロック
  - `[end of text]`
  - `<|im_end|>`
  - JSON前後に混ざる短いログ・余白

## 目的

v312でFAQ改善プロンプトの実行経路は前進したが、生成後のJSON解析用メソッドが未定義だったため、UIに関数未定義エラーが表示されていた。
V313では生成結果のJSON解析処理をクラス内メソッドとして固定し、FAQ改善案クリック時の未定義エラーを解消する。
