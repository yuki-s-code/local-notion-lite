# v299 llama.cpp prompt file execution fix

## 背景

v298では `llama-cli` の実行時に、FAQ改善用の長い日本語プロンプトを `-p` 引数へ直接渡していた。
この方式では、OSや実行環境、llama.cpp側の引数処理により、失敗時の原因が分かりにくく、コマンド全体がエラーメッセージに露出しやすかった。

## 修正内容

- プロンプトを一時ファイルへUTF-8で保存
- `llama-cli -f <prompt-file>` で実行
- 実行時 `cwd` を llama 実行ファイルのフォルダに設定
- `PATH` / `DYLD_LIBRARY_PATH` / `LD_LIBRARY_PATH` に llama フォルダを追加
- 失敗時に stderr/stdout を含む分かりやすいエラーへ変換
- Mac向けに quarantine / chmod のヒントを表示

## 効果

- 日本語・改行・長文プロンプトに強くなる
- `.dylib` / `.dll` 解決が少し安定する
- 生成失敗時の切り分けがしやすくなる

## 注意

Macで未署名バイナリがブロックされる場合は、信頼できる入手元であることを確認したうえで次を実行する。

```bash
xattr -dr com.apple.quarantine /path/to/llama-folder
chmod +x /path/to/llama-folder/llama-cli
```
