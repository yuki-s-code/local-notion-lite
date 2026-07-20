# v308 llama-completion優先修正

## 背景

llama.cpp build b9632 の `llama-cli` は対話型REPLとして動作し、`-p` や `-f` で回答を即時生成しても、生成後に `>` の入力待ち状態で残る場合があります。
そのためアプリ側では回答がターミナルに出ているにもかかわらず、プロセス終了待ちで60秒タイムアウトになっていました。

## 修正

- `llama-completion` / `llama-completion.exe` を実行ファイル候補の最優先に変更
- 既存設定が `llama-cli` を指していても、同じフォルダに `llama-completion` があれば生成時に自動切替
- `llama-cli` の `--no-conversation is not supported` 問題を回避
- エラー詳細に stdout / stderr の先頭を表示

## 期待結果

テスト生成で `llama-completion` が使われ、`こんにちは` の生成後にプロセスが即時終了し、UIにも即時反映されます。
