# V333 Database Computation Optimization

## 目的

v332時点でTableビュー自体はすでに仮想スクロール済みだったため、v333では描画前に残っていた全件計算・Relation候補の全件描画を軽量化する。

## 変更内容

- `DatabaseTable` の重複 `serverPerf` state 定義を修正。
- 大量DB時の server table mode 既定値を `LARGE_DB_AUTO_THRESHOLD` に合わせ、2,000行以上でより積極的にSQLiteページングを使えるように変更。
- server table mode中は `clientVisibleRows` の全件filter/sortを実行しないように変更。
- 選択行数を `visibleRows.filter(...)` ではなく `selectedIds` から計算し、毎レンダー時の全件走査を軽減。
- 入力率・チェック完了数・最新更新日の集計を1つの `databaseStats` に統合。
- 大量DBでは先頭2,500件のサンプル集計に切り替え、集計が描画のボトルネックになりにくいように変更。
- 最新更新日の算出を `map().sort().at(-1)` から1回の `reduce` に変更。
- Relation候補の描画件数を制限。
  - 通常時: 120件
  - 検索時: 240件
- Relation候補が多い場合は「先頭のみ表示中」の案内を表示し、検索で絞り込ませる。

## 期待効果

- 大量DB表示時の初期描画前の計算負荷を軽減。
- Tableビューで仮想スクロールが入っていても残っていたfilter/sort/集計の重さを抑制。
- Relation候補ポップアップで大量候補を一気に描画しないため、セル編集時の引っかかりを軽減。

## 注意

- Tableビューの仮想スクロール自体は既存実装を維持。
- 数値/日付/Select/Relationなどの構造化処理は引き続き通常SQLite・既存ロジック側で扱う。
- 大量DBでの入力率はサンプル集計になるため、厳密値ではなく体感速度優先の参考値になる。
