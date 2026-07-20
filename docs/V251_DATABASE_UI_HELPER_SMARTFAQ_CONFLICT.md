# V251 Database UI / Helper / Smart FAQ / Conflict UX

## 対応内容

### 1. DatabaseTable UI の追加分割

`DatabaseTable.tsx` に残っていた周辺UIを `DatabaseUtilityPanels.tsx` へ分離しました。

対象:

- Dashboard
- Templates
- Trash
- JSON backup import/export
- Integrity check launcher
- Task Pack launcher

これにより、DB本体のTable/状態管理と、補助パネルUIの責務を分けています。

### 2. DatabaseHelpers のドメイン別入口を追加

既存 import 互換を維持するため `DatabaseHelpers.ts` は facade とし、実装を `DatabaseCoreHelpers.ts` に移しました。

追加した補助入口:

- `DatabaseCsvHelpers.ts`
- `DatabaseRelationHelpers.ts`
- `DatabaseFormulaHelpers.ts`
- `DatabaseDateHelpers.ts`
- `DatabaseDisplayHelpers.ts`

既存ファイルは今まで通り `DatabaseHelpers.ts` から import できます。今後の新規修正はドメイン別ファイルを入口にできます。

### 3. Smart Assist FAQ API の型バリデーションを厳格化

`validation.ts` の `smartFaqRecord` を `z.record(z.any())` から専用 schema へ変更しました。

主なチェック:

- `question` 必須
- `answer` 必須
- `status`: `draft | reviewed | approved | hidden`
- `confidence`: 0〜100
- 配列項目数・文字数の上限
- likelyQuestions / paraphrases / negativeTerms / intent 系の上限

既存互換のため `.passthrough()` は維持しています。

### 4. DB競合発生時のUI通知を改善

サーバー側エラーに `code` を付与しました。

- `DATABASE_CONFLICT`
- `DATABASE_LOCKED`

Renderer側では `ApiError` を追加し、DB自動保存・手動保存・公開範囲変更時に、競合/ロックをユーザー向けの説明に変換します。

競合時は以下を明示します。

- 別端末または別ウィンドウで更新されたこと
- 編集内容は `conflicts` フォルダに退避されていること
- 再読み込みしてから編集を続けるべきこと
- current/base updatedAt が取れる場合は併記

## 非対象

- package-lock.json
- GitHub Actions の npm ci 化
- kuromoji

kuromoji は引き続き使用していません。
