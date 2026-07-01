# V346 llama-server 高速AI常駐モード

## 目的

生成AIを使うたびに `llama-completion` を起動する標準方式に加え、対応環境では `llama-server` を常駐させ、モデルを読み込んだまま利用できるモードを追加しました。

## 実行方式

- 標準: 1回起動方式
  - 生成ごとに `llama-completion` を起動
  - 安全で互換性が高い
  - 会社端末では exe / gguf / prompt の検査で遅くなる場合がある

- 高速AI常駐: llama-server
  - `llama-server` を起動し、モデルを読み込んだまま保持
  - 生成は `http://127.0.0.1:<port>/completion` に送信
  - 失敗時は設定により1回起動方式へ自動fallback

## 設定画面

生成AI設定に以下を追加しました。

- 実行方式
  - 標準: 1回起動方式
  - 高速AI常駐: llama-server
- 常駐Host
- 常駐Port
- 常駐自動起動
- 失敗時Fallback
- 常駐状態
- 常駐起動
- 常駐停止
- PID / 使用メモリ表示

## API

- `GET /smart-assist/generation-server/status`
- `POST /smart-assist/generation-server/start`
- `POST /smart-assist/generation-server/stop`

## 注意

`llama-server.exe` / `llama-server` が llama.cpp フォルダ内にある環境のみ利用できます。見つからない場合、標準の `llama-completion` 方式はそのまま利用できます。
