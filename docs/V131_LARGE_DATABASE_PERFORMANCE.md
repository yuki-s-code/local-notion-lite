# v131 Large Database Performance

大量行を入れても扱いやすくするための安定化版です。

## 追加・改善

- Large DB Mode を追加
  - 2,000行以上のDBでは自動ON
  - 手動でON/OFF可能
- Tableビューの仮想表示を強化
  - 実際に見えている行だけを描画
  - スクロール時のDOM増加を抑制
- 検索入力を遅延反映
  - 入力中の固まりを軽減
- フィルター・ソートがない場合は行配列をそのまま使う高速経路を追加
- Board / Calendar / Gallery / Timeline / Gantt の大量描画を制限
  - Large DB Mode中は先頭1,200件まで表示
  - 検索・フィルターで絞れば対象行を表示可能
- Large DB状態をlocalStorageへ保存
- 描画負荷を下げるCSS contain / will-changeを追加

## 推奨運用

- 1,000行未満: 通常運用で問題なし
- 2,000行以上: Large DB Mode推奨
- 5,000行以上: Table + フィルター中心の運用推奨
- Board / Calendar / Ganttは、日付や状態で絞ったビューを作って使う

## 注意

現時点ではクライアントメモリ上でDB全体を保持します。10万行級を本格運用する場合は、次段階でSQLiteのページングAPI・サーバー側検索・インデックスを導入するのが理想です。
