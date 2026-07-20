# V246 Smart Assist Store Split

## 目的

V245で検索・回答採用パイプラインを `smartAssist/transformerFirstPipeline.ts` に分離したため、V246では Smart Assist のJSON保存系も `vaultService.ts` から段階的に分離しました。

## 追加ファイル

- `src/server/services/smartAssist/smartAssistStore.ts`

## 分離した責務

`SmartAssistStore` に以下の責務を移しました。

- 同義語辞書 `synonyms.json`
- ルールプロファイル `rule-profiles.json`
- Transformer設定 `transformer-settings.json`
- 改善キュー `faq-improvement-queue.json`
- 評価セット `faq-evaluation-set.json`
- 評価レポート `faq-evaluation-report.json`
- チャットログ `chat-logs.json`
- 各JSONファイルのパス解決
- 標準seedデータの安全な補完
- 保存前の正規化と件数制限

## 互換性

既存の Express API や Renderer から呼ばれる `VaultService` の公開メソッド名は維持しています。

例:

- `listSmartAssistSynonyms()`
- `saveSmartAssistSynonyms()`
- `listSmartAssistRuleProfiles()`
- `getSmartAssistTransformerSettings()`
- `listSmartAssistImprovementQueue()`
- `listSmartAssistEvaluationSet()`
- `listSmartAssistChatLogs()`

これらは内部で `SmartAssistStore` に委譲します。

## kuromoji方針

kuromoji は引き続き使用しません。V246でも追加していません。

現在のSmart Assist方針は以下です。

- 日本語正規化
- Transformers.js 意味検索
- SQLite FTS5 / N-gram補助
- metadata guard
- negativeTermsによる誤答抑制

## 非対象

ユーザー指定により以下は未対応です。

- `package-lock.json` 追加
- GitHub Actions の `npm ci` 化

## 次の候補

次に進めるなら、以下のどちらかが高優先です。

1. API入力バリデーションを zod で追加
2. DB保存時の競合検出・database lock を追加
