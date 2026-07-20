# v301 llama.cpp実行診断の強化

## 目的

v300では、llama-cli の実行に失敗した場合に、画面上へ `Command failed:` のコマンドだけが表示され、実際の失敗理由を判断しにくいケースがあった。

v301では、FAQ改善案生成時の llama.cpp 実行エラーについて、以下を表示する。

- stderr
- stdout
- exitCode
- signal
- killed
- executable
- cwd
- args
- promptFile

## 追加改善

llama.cpp の配布版によっては `--no-display-prompt` が使えない場合があるため、初回実行に失敗した場合は `--no-display-prompt` を外して再試行する。

## Macでの確認

Macで失敗する場合は、まずターミナルで以下を確認する。

```bash
xattr -dr com.apple.quarantine /Users/fujiwaraisamusei/Desktop/SmartAssistModels/bin/llama-b9632
chmod +x /Users/fujiwaraisamusei/Desktop/SmartAssistModels/bin/llama-b9632/llama-cli
/Users/fujiwaraisamusei/Desktop/SmartAssistModels/bin/llama-b9632/llama-cli --help
```

さらに短い生成テストを行う。

```bash
/Users/fujiwaraisamusei/Desktop/SmartAssistModels/bin/llama-b9632/llama-cli \
  -m /Users/fujiwaraisamusei/Desktop/SmartAssistModels/generation/qwen2.5-3b-instruct-q4_k_m.gguf \
  -p 'こんにちは。短く返事してください。' \
  -n 32 \
  -c 1024 \
  --temp 0.1
```
