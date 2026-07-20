# V770 External Source Operations

外部ソース運用を、検索画面への個別機能追加ではなく共通のExternal Source Recordを中心に再構成しました。

## 追加機能
- 更新差分ビュー（行単位LCS差分）
- リンク・取込・同期の3方式
- 同期エラー解決センター
- Calendar会議ワークフロー
- Gmail対応管理
- TTL/LRU外部ソースキャッシュと通信失敗時のstale fallback
- 重複排除付きBackground Sync Queue

## 保存責務
- external-source-records-v1: 外部ソースの正本メタデータ、現在・前回スナップショット
- external-source-cache-v1: 検索キャッシュ（最大180件）
- external-source-issues-v1: 未解決同期問題
- external-background-sync-v1: バックグラウンドジョブ
- meeting-workflows-v1 / gmail-actions-v1: 実務ワークフロー

## 3方式
- リンク: Googleを正本としてURLとメタデータを参照
- 取込: Drive本文を取得しローカルノートとして固定保存
- 同期: 外部ID、スナップショット、同期状態を保持し差分・競合管理対象にする

## 効率化
- Provider検索に共通キャッシュを適用
- 同一同期ジョブはpending/running中に再登録しない
- 一括追加も単一追加関数を再利用
- 同期・差分・エラー・ワークフローが同じExternal Source Recordを参照
