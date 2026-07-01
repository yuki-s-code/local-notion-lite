# v164 Private Storage Paths

## 追加内容

- BlockNoteのPrivateページ保存先を設定画面から選択可能にしました。
- Private DB保存先を設定画面から選択可能にしました。
- Sharedページ/Shared DBは従来どおり共有フォルダに保存されます。
- Privateページ/Private DBは選択したローカル/個人フォルダに保存されます。
- 未設定の場合は従来どおり、このPCのアプリデータ内 `private-vault` を使用します。

## 注意

保存先変更は次回起動から反映されます。既存Privateデータは自動移動しません。必要な場合は旧保存先から新保存先へ手動コピーしてください。

## Relation Guard

v163のルールを維持します。Shared DBからPrivateページ/Private DBへのRelationは作成できません。
