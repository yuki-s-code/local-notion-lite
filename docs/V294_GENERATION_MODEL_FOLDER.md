# v294 Generation Model Folder Settings

## 目的

生成AIモデルをアプリ本体に同梱せず、ユーザーが任意の外部フォルダを選択して利用できるようにするための基盤を追加した。

会社PCでは `exe` 起動だけで運用する前提のため、Node.js / Python / Ollama / 管理者権限を必要としない構成を維持する。

## 追加した画面

Smart Assist管理画面に `生成AI` タブを追加した。

設定できる項目:

- 使用しない / llama.cpp / GGUF
- GGUFモデルフォルダ
- 検出された `.gguf` モデルの選択
- llama.cpp実行ファイルパス
- プリセット: 軽量・標準 / 高品質・やや重い / 手動
- context size
- max tokens
- temperature

## 追加API

```txt
GET  /smart-assist/generation-settings
POST /smart-assist/generation-settings
GET  /smart-assist/generation-check
```

`generation-check` は、指定フォルダ配下を深さ3まで走査し、`.gguf` ファイルを検出する。

## モデル配置例

```txt
SmartAssistModels/
  generation/
    qwen2.5-1.5b-instruct-q4_k_m.gguf
    qwen2.5-3b-instruct-q4_k_m.gguf
```

または:

```txt
LocalNotionLite/
  Local Notion Lite.exe
  resources/
    bin/
      llama-cli.exe
  models/
    generation/
      qwen2.5-1.5b-instruct-q4_k_m.gguf
```

## 重要な設計判断

v294では、実際の生成実行はまだ強く結合していない。

理由:

- 生成AIは端末性能差が大きい
- 誤答防止のため、最初はFAQ改善案・要約・下書きに限定する
- モデルフォルダ選択、モデル検出、llama実行ファイル検出を先に安定させる

## 推奨モデル

標準:

```txt
Qwen2.5-1.5B-Instruct Q4_K_M
```

上位:

```txt
Qwen2.5-3B-Instruct Q4_K_M
```

7B以上は手動選択可能だが、会社PCの標準にはしない。

## 次の実装候補

v295では、今回の設定を使って `FAQ改善案生成` を追加する。

最初に追加する生成用途:

- FAQの別質問例
- 回答文の整形案
- 不足確認項目
- 低信頼ログからFAQ候補を作成

回答本文の自動生成にはまだ使わない。
