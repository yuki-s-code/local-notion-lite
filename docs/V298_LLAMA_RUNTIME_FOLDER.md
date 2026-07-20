# v298 llama実行フォルダ選択

## 目的

v297までは `llamaExecutablePath` に `llama-cli` 単体を指定する設計だったため、ユーザーが `llama-cli` だけを別フォルダへ移動し、`.dylib` / `.dll` などの依存ライブラリ不足で実行できない問題が起きやすかった。

v298では、生成AI設定を **llama.cppを解凍したフォルダをそのまま選択する方式** に変更した。

## 変更点

- `llamaRuntimeDir` を generation settings に追加
- main/preload/global に `chooseGenerationRuntimeDir` を追加
- サーバー側で `llamaRuntimeDir` 内の `llama-cli` / `llama-cli.exe` を自動検出
- 同じフォルダ内の `.dylib` / `.dll` 件数を確認
- `.gguf` を実行ファイルとして指定した場合は引き続き警告
- 手動の `llamaExecutablePath` は詳細設定に退避

## 推奨配置

```txt
SmartAssistModels/
  llama/
    llama-cli            # Mac/Linux
    llama-cli.exe        # Windows
    *.dylib / *.dll

  generation/
    qwen2.5-1.5b-instruct-q4_k_m.gguf
    qwen2.5-3b-instruct-q4_k_m.gguf
```

## UI

ユーザーは以下を選択する。

1. モデルフォルダ: `.gguf` があるフォルダ
2. llamaフォルダ: llama.cppを解凍したフォルダ

`llama-cli` 単体を取り出して移動する運用は非推奨。

## 互換性

既存の `llamaExecutablePath` は残している。高度な手動指定のみで使用する。
通常は `llamaRuntimeDir` を優先する。
