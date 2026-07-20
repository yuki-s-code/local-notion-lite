# V306 llama-cli b9632 no-conversation warning fix

## 問題

llama.cpp build b9632 の `llama-cli` では、`-no-cnv` / `--no-conversation` 系の非対話化オプションが非対応で、次の警告が出る場合がある。

```txt
--no-conversation is not supported by llama-cli please use llama-completion instead
```

v305ではこの警告を生成結果として誤判定し、画面に「テスト生成OK」と表示してしまうことがあった。

## 修正

- `llama-cli` 実行引数から `-no-cnv` と `--no-display-prompt` を削除
- b9632の対話モード出力を前提に、回答本文だけを抽出する方式に変更
- `is not supported by llama-cli` / `please use llama-completion instead` を回答として扱わない
- `Loading model...` などの実行ログを除去対象に追加

## 期待結果

テスト生成で、ターミナルに次のような出力が出ても、画面には `こんにちは` だけが表示される。

```txt
> <|im_start|>assistant

こんにちは<|im_end|>

[ Prompt: ... | Generation: ... ]
>
Exiting...
```
