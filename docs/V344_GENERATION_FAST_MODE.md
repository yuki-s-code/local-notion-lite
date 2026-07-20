# V344 Generation Fast Mode

目的: 会社端末で生成AIテストやFAQ改善が数百秒かかる問題を抑える。

## 変更点

- 生成AI設定に `performanceMode` を追加
  - `fast`: 会社PC向け
  - `standard`: 標準
  - `quality`: 品質重視
- 生成AI設定に `retryMode` を追加
  - `off`: 1回だけ実行
  - `on-error`: 失敗時のみ1回再試行
  - `full`: 旧来に近い詳細リトライ
- 生成AI設定に `totalTimeoutMs` を追加
  - 1回ごとのtimeoutとは別に、生成全体の上限を設定する。
- 既定値を会社PC向けに変更
  - preset: `fast`
  - contextSize: `1024`
  - maxTokens: `128`
  - timeoutMs: `45000`
  - totalTimeoutMs: `60000`
  - retryMode: `off`
- 軽量テスト生成は必ず1回だけ実行
  - contextSize: `512`
  - maxTokens: `32`
  - timeoutMs: `10000`
  - totalTimeoutMs: `12000`
- 高速モードでは長文promptでもContext 2048へ自動底上げしない。
- テスト生成結果に実行コマンド概要、context、maxTokens、性能モード、retryModeを表示する。

## 期待効果

旧実装では、1回の生成に見えても内部で複数回 `llama.cpp` が起動し、会社端末では 120秒 x 複数回 のようになり得た。
V344では会社PC向け既定で1回実行・全体上限60秒に抑える。

## 注意

`retryMode=off` では空出力や失敗時に自動フォールバックしない。安定性より速度を優先する設定。
出力が空になる場合は、手動で標準/詳細リトライに切り替える。
