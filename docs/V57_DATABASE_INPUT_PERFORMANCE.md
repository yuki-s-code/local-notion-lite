# v57 Database Input Performance

セル入力時にデータベース全体が重くなる問題への対策。

## 修正

- DatabaseTable 内にローカルドラフト状態を追加
- 文字入力中は親 App の currentDb を毎キー更新しない
- 650ms の遅延コミットで保存対象へ反映
- データベースID変更時だけ外部データでドラフトを再初期化
- 表示行固定・行追加安定化は維持

## 狙い

TanStack Table / Recharts / 親状態更新 / 自動保存が入力ごとに連鎖しないようにし、セル入力を軽くする。
