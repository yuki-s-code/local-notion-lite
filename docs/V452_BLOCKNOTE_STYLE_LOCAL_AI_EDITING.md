# v452 BlockNote風ローカルAI編集

## 方針

`@blocknote/xl-ai` はBlockNote XLの商用ライセンス条件に依存するため、本バージョンでは導入していません。
代わりに既存の Local Notion Lite の Express + llama.cpp + Smart Assist API を利用し、BlockNoteの編集画面にAI編集パネルと `/ai` コマンドを追加しました。

## できること

- 選択範囲の要約
- 読みやすい業務文への書き換え
- 箇条書き化
- TODO・確認事項の抽出
- 自由な指示（Ctrl/Cmd + Enterで生成）
- 生成結果のプレビュー後に、選択範囲置換または末尾追加

## 安全性

- 生成結果は自動保存・自動置換しません。
- 「選択範囲を置換」または「末尾に追加」を明示的に押した時だけBlockNoteへ反映します。
- 既存のページ保存、履歴、編集ロック、Semantic Index差分更新が通常どおり適用されます。
- AI利用時は既存の `generateWorkspaceAiChatAnswer` APIを使い、選択範囲をページコンテキストとして渡します。

## 制限

- 現時点ではストリーミング表示ではなく、生成完了後のプレビュー表示です。
- 選択範囲の置換はBlockNote内部のTiptapコマンドを利用する互換経路です。BlockNote更新後は実機確認が必要です。
- 公式 `@blocknote/xl-ai` のAIエージェントによるブロック単位の逐次編集、AI変更差分UI、ネイティブツール呼び出しは含みません。
