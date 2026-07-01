# V297 Generation Executable Validation

## 背景

v296 では `llamaExecutablePath` に `.gguf` モデルファイルを指定しても、ファイルが存在するだけで `llama確認済み` になってしまうケースがありました。

例:

```txt
llamaExecutablePath: qwen2.5-3b-instruct-q4_k_m.gguf
```

これは実行ファイルではなくモデルファイルです。`llama.cpp` を使う場合は、次の2つを分けて指定する必要があります。

```txt
使用モデル        : *.gguf
llama実行ファイル : llama-cli.exe / llama.exe / llama-cli
```

## 修正内容

### 1. `.gguf` を llama 実行ファイルとして扱わない

`checkSmartAssistGenerationEngine()` で、`llamaExecutablePath` が `.gguf` の場合は利用不可として判定します。

### 2. 実行ファイル名を検証

Windows では `.exe`、Mac/Linux では `llama-cli` / `llama` / `llama-run` を有効候補として扱います。

### 3. UIで警告表示

生成AI設定画面で、llama実行ファイル欄に `.gguf` が入っている場合は警告を表示します。

### 4. FAQ改善案生成の誤フォールバックを防ぐ

llama実行ファイルが不正な場合は、生成AI利用可能とは表示せず、FAQ改善案生成もテンプレートにフォールバックした理由を明示します。

## 正しい設定例

```txt
モデルフォルダ:
SmartAssistModels/generation

使用モデル:
SmartAssistModels/generation/qwen2.5-3b-instruct-q4_k_m.gguf

llama実行ファイル:
LocalNotionLite/resources/bin/llama-cli.exe
```

Mac開発環境では例:

```txt
llama実行ファイル:
/Users/xxx/SmartAssistModels/bin/llama-cli
```

## 注意

`.gguf` はAIモデルです。単体では実行できません。  
`.gguf` を読み込んで文章生成する実行部が `llama-cli.exe` / `llama.exe` です。
