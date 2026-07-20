# V310 llama-completion stdout JSON extraction fix

## 問題
v309では llama-completion の実行自体は成功し、stdout に以下のような本文が出ていた。

```json
{
  "answer": "こんにちは"
}
```

しかし stderr 側の詳細ログと結合した後の抽出処理が本文を取り逃がし、`生成結果が空でした` と誤判定していた。

## 修正
- `cleanLlamaGeneratedText()` の冒頭で fenced JSON を最優先抽出
- `[end of text]`、ChatML終端トークン、ログ尾部を除去
- `{ ... }` の balanced JSON が見つかった場合は、そのJSONを即採用
- 軽量テスト生成では `{"answer":"こんにちは"}` を表示用に `こんにちは` へ変換

## 期待結果
軽量テスト生成は次のように表示される。

```txt
テスト生成OK: こんにちは / 1秒
```

## 補足
llama-completion の stderr に出る `common_init_from_params` や `sampler params` は異常ではない。stdout に本文があれば成功として扱う。
