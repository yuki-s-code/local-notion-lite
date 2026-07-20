# V304 Generation Status & Timeout Fix

## 目的

生成AI（llama.cpp / Qwen GGUF）で、回答が遅いのか、停止しているのか、失敗しているのか分からない問題を改善する。

## 変更内容

- 生成AI実行に `timeoutMs` を追加
  - 既定値: 120秒
  - 設定画面で 30〜300秒の範囲で変更可能
- FAQ改善案生成中に経過秒数と上限秒数を表示
- タイムアウト時に明確なエラーメッセージを返す
- 生成AI設定画面に「軽量テスト生成」ボタンを追加
  - `こんにちは` を返すだけの軽量テスト
  - Context 512 / Max tokens 64 / Temperature 0 / Timeout 60秒
- Qwen向けフォールバックを強化
  - `-p ChatML -sp`
  - `-p ChatML`（`-sp`なし）
  - `-f ChatML -sp`
  - compact prompt
- Qwenの `-p` 渡しプロンプトを最大6000文字に制限
- llama.cppログ除去パターンを追加

## 注意

このZIPには `package-lock.json` は含まれていません。GitHub Actionsで `npm ci` を使う場合は、Mac側で `npm install` を実行して `package-lock.json` を生成し、コミットしてください。
