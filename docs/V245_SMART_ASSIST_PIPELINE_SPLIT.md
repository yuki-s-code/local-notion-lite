# V245 Smart Assist Pipeline Split

## 目的

`vaultService.ts` に集中していた Smart Assist の回答採用ロジックを、専用ファイルへ分離した。

## 変更点

- `src/server/services/smartAssist/transformerFirstPipeline.ts` を追加
- `askSmartAssist()` から Transformer-first 検索パイプラインを外部関数として呼び出す構成に変更
- active path は引き続き以下に一本化
  - Transformers.js semantic search
  - SQLite FTS5 / N-gram backup
  - metadata guard
  - negativeTerms penalty
  - low-confidence improvement queue

## 非対象

以下は今回変更していない。

- package-lock.json 追加
- GitHub Actions の npm ci 化
- Renderer の大規模分割
- API zod validation
- database lock / conflict detection

## kuromoji 方針

kuromoji は使用しない。日本語検索補助は正規化、表層語、N-gram、FTS5、Transformers.js を中心にする。
