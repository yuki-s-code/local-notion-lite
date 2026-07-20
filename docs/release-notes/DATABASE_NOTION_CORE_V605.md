# データベース強化・全体監査 v605

## 実装した内容

### 1. Status プロパティ
- `select` と別のプロパティ型として追加。
- 初期選択肢は **未着手 / 進行中 / 完了**。
- Table・Form・Board・一括編集・集計・フィルター・Server Table・DB索引のすべてで選択型として扱う。
- 既存の `select` は一切変えないため、既存DBとの互換性を維持する。

### 2. Unique ID プロパティ
- `案件-0001` のような不変の自動採番IDを追加。
- プロパティ画面で接頭辞と桁数を設定可能。
- 新規行・複製行・既存DBへのプロパティ追加時に、空欄行へだけ採番する。
- サーバー正規化時にも不足IDを補完するため、Rendererの一時状態・CSV取込・既存DBの保存経路でも重複を避ける。
- 一度発行したIDは直接編集できない。

### 3. 複合AND / ORフィルター
- ビューごとに **すべて満たす（AND）** と **いずれか満たす（OR）** を選択可能。
- Client View と SQLite Index の Server Table で同じ評価ロジックを使用。
- 既存ビューに `filterLogic` がない場合は、従来どおりANDとして扱う。

## 性能への配慮
- ORフィルターも SQLite の `database_row_property_index` を使うため、大規模DBで全行をRendererに送らない。
- Unique IDは通常の行保存に含まれるプロパティ索引だけを更新する。
- 既存DBでUnique IDプロパティを追加する時だけ、既存行の採番が必要になるため全行を一度だけ処理する。

## 検証
- 変更したTypeScript/TSXファイルは TypeScript transpile による構文検証を実施。
- プロジェクト全体の `npm run typecheck` はZIPに `node_modules` が入っておらず、`electron` と `node` の型定義不足で開始前に停止するため、完全な型検証は未実行。

## 次の推奨順
1. DB行の親子構造（サブアイテム）と親の進捗自動集計
2. Formulaのサーバー側依存キャッシュ
3. Button / アプリ内Automation
4. List・Chartの保存済みDBビュー
