# v300 llama prompt execution string literal fix

## 修正内容

v299で追加した llama.cpp 実行失敗時の詳細メッセージ生成処理に、TypeScriptの文字列リテラルが壊れる差分が入っていました。

該当箇所を次のように修正しました。

```ts
const detail = [stderr, stdout, err?.message].filter(Boolean).join('\n').slice(0, 3000);
```

## 影響

- `npm run dev` / Vite SSR build で発生していた `Unterminated string literal` を解消します。
- v299の「プロンプトを一時ファイルに保存して `llama-cli -f` で実行する」処理は維持します。
- llama.cpp 実行エラー時の stderr/stdout 詳細表示も維持します。
