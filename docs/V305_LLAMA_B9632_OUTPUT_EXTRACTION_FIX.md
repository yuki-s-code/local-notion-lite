# V305 llama.cpp b9632 output extraction fix

## 修正目的

v304では、llama.cpp b9632系の `llama-cli` が `-p` 指定時にも対話モード風の出力を返す環境で、実際には回答が生成されているにもかかわらず、アプリ側が回答本文を抽出できず「生成結果が空でした」と判定する問題があった。

ユーザー環境ではターミナル上で以下のように回答は生成されていた。

```txt
<|im_start|>assistant

こんにちは<|im_end|>

[ Prompt: ... | Generation: ... ]
>
Exiting...
```

## 原因

`llama-cli` の出力に以下が混在していた。

- llama.cpp の起動バナー
- available commands
- `> ` 付きの対話プロンプト
- ChatMLのsystem/user/assistantプロンプト表示
- 速度ログ `[ Prompt: ... | Generation: ... ]`
- `Exiting...`

v304のクリーニング処理では、この形式の出力から回答本文だけを安定抽出できない場合があった。

## 修正内容

- Qwen実行の第一候補に `-no-cnv` と `--no-display-prompt` を追加
- Qwenのフォールバックにも `-no-cnv` と `--no-display-prompt` を追加
- compact fallbackにも `-no-cnv` と `--no-display-prompt` を追加
- `cleanLlamaGeneratedText()` を強化
  - `available commands:` を除去
  - `/exit`, `/regen`, `/clear`, `/read`, `/glob` 行を除去
  - `build:`, `model:`, `modalities:` を除去
  - ASCII/Unicodeバナー行を除去
  - `[ Prompt: ... | Generation: ... ]` を除去
  - `>` のみの対話プロンプト行を除去
  - `Exiting...` を除去
  - `> <|im_start|>assistant` のような形式からassistant以降を抽出
  - Markdownコードブロック内JSONも抽出

## 期待される結果

軽量テスト生成では、少なくとも以下のような結果を取得できる。

```txt
こんにちは
```

FAQ改善生成では、モデルがコードブロック付きJSONを返してもJSON本体を抽出する。

