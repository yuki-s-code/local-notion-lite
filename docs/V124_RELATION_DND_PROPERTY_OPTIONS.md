# v124 Relation / Drag and Drop / Property Options

## 修正内容

- Relation セルを強化しました。
  - 候補検索を追加
  - 選択済みRelationをタグ表示
  - 選択済みRelationの個別解除・全解除を追加
  - Page / Journal / 他Database行へのRelation表示を改善

- ドラッグ＆ドロップを追加しました。
  - Table行をドラッグして並び替え可能
  - Propertiesパネルでプロパティカードをドラッグして列順を変更可能
  - Boardカードを別レーンへドラッグすると、グループ化プロパティを更新

- 「選択肢を編集」を修正しました。
  - prompt入力ではなく、Propertiesパネル内にインライン選択肢エディタを表示
  - 選択肢の追加、名前変更、削除が可能
  - 選択肢名変更時は既存行セルの値も追従
  - 選択肢削除時は既存行セルから該当値を削除/クリア

- 保存安定性を改善しました。
  - relationTargetType をサーバー側 normalizeDatabase で保持
  - Calendar / Timeline の datePropertyId / startDatePropertyId / endDatePropertyId を保持

## 注意

ZIPには node_modules を含めていません。型チェックは依存関係をインストールした環境で実行してください。
