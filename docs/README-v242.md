# v242 FAQ editor foreground modal fix

- FAQ編集 / 新しいFAQ作成モーダルを管理画面より前面に固定表示
- 背景を暗めのブラー付きオーバーレイに変更
- 編集モーダルのヘッダー/本文/フッターを安定化
- 編集フォーム本文は内部スクロール、管理画面側スクロールとは分離

## v435 Semantic Index revision invalidation
- Semantic Indexの再構築・差分更新後、関連ページ結果を索引世代で自動無効化します。
- 新規ページが索引へ反映された後は、更新ボタンなしで現在ページの関連情報を再検索します。

## v450: Semantic Index cache hygiene

- Semantic SQLite / sqlite-vec / FTS5 are treated as local rebuildable cache only; shared JSON remains the source of truth.
- After semantic sync, a deferred hygiene pass removes stale vec/FTS maps and resolved failure records.
- The Smart Assist admin screen shows cleanup status, cache size, and orphan diagnostics.
- `不要データを掃除` runs safe cleanup. `容量を整理` additionally checkpoints WAL and runs manual VACUUM; it never modifies shared workspace JSON.

## v452: BlockNote風ローカルAI編集

- BlockNoteの編集画面にAI編集パネルと `/ai` コマンドを追加しました。
- 既存llama.cpp / Smart Assist APIを利用し、要約、書き換え、箇条書き、TODO抽出、自由指示を実行します。
- 結果はプレビュー後に明示適用します。公式 `@blocknote/xl-ai` は商用ライセンス確認後に差し替え可能です。


## v471 — 正式版更新の差分要約

- Wiki管理に「正式版の更新」カードを追加
- 既存の履歴スナップショットとの差分から、追加・削除・変更の要点を表示
- 新しい通知DBや保存先は作らず、既存履歴から都度導出
- 必要なときだけ既存のストリーミングAIチャットへ詳細要約を依頼
