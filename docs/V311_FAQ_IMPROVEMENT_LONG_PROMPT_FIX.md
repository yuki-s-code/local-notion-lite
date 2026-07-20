# V311 FAQ改善案 長文プロンプト修正

## 背景

V310では軽量テスト生成は成功したが、FAQ改善案では次の問題が残っていた。

- `llama-completion` は即時に stdout へ回答を出している
- しかしアプリ側が stdout の JSON コードブロックを拾えず「生成結果が空」と誤判定することがあった
- FAQ改善案の長文プロンプトを `-p "..."` に直接渡していたため、llama-completion の conversation mode と衝突しやすかった

## 修正内容

- `llama-completion` 実行時の長文プロンプトを `-p` 直接渡しから `-f rawPromptFile` 優先へ変更
- `-sys` は維持し、system prompt と user prompt を分離
- `--no-warmup` を追加し、起動待ちを軽減
- stdout だけを最優先で解析する `extractLlamaPrimaryAnswer()` を追加
- ```json ... ```、`[end of text]`、JSONオブジェクトを優先抽出
- stderr の llama.cpp 診断ログを本文判定から切り離し

## 期待される状態

FAQ改善案でも、stdout に以下のような出力がある場合は失敗扱いにしない。

```json
{
  "summary": "...",
  "improvedQuestion": "...",
  "improvedAnswer": "..."
}
```

また、テスト生成と同様に画面へ短時間で反映される。
