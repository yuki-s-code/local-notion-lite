# v126 Relation Navigation and Backlinks

## 目的
Relationを「紐付けるだけ」ではなく、実際の業務でたどれる情報リンクとして使えるようにした。

## 変更内容

1. Relation Mapを追加
   - Propertiesパネル上部に、このDBのRelation列と接続先を表示。
   - Relation列がどこにつながっているかを確認しやすくした。

2. Relation先を開く導線を追加
   - 行詳細のRelationチップをクリックすると、対象を開く/選択できる。
   - 同じDB内の行Relationは、その行を詳細表示する。
   - 他DB行Relationは対象DBを開く。
   - Page Relationは対象ページを開く。
   - Journal Relationは対象Journalを開く。

3. 逆引きRelationを追加
   - 行詳細に「逆引きRelation」を表示。
   - 現在の行を参照している他のDB行を一覧表示。
   - 案件DBとタスクDBのような親子関係を追いやすくした。

4. Relation候補の操作性を改善
   - 閲覧時のRelationチップをクリック可能に変更。
   - 編集中の選択済みRelationは、クリックで解除・ダブルクリックで開く挙動にした。

## 想定ユースケース

- タスクDBの行から関連ページを開く。
- 案件DBの行から関連タスクDBへ移動する。
- 資料DBの行から関連Journalを開く。
- タスク行の詳細で、そのタスクを参照している案件行を逆引きする。
