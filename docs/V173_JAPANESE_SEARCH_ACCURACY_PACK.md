# V173 Japanese Search Accuracy Pack

目的: Local Smart Assist / FAQ検索を、単純な文字列一致ではなく、日本語形態素解析・同義語展開・あいまい検索・独自スコアリングで強化する。

## 追加内容

- `kuromoji` による日本語形態素解析
- `Fuse.js` によるあいまい検索
- 日本語正規化
  - NFKC正規化
  - 全角/半角ゆれ吸収
  - ひらがな/カタカナゆれ吸収
  - 記号・空白ゆれ吸収
- 業務用語・同義語辞書
  - 年休 / 有休 / 年次有給休暇
  - 忌引 / 服喪 / 特別休暇
  - 会計年度任用職員 / 非常勤
  - 学童 / 放課後児童クラブ
  - 給与 / 給料 / 報酬
  - 社会保険 / 健康保険 / 厚生年金
  - 申請 / 届出 / 手続
- FAQごとのスコアリング
  - 質問タイトル一致を高く評価
  - 回答本文一致を評価
  - カテゴリ・タグ一致を評価
  - 同義語一致を評価
  - 承認済み/確認済みFAQを加点
- 検索結果に一致理由を付与
- 検索結果に一致語と自信度ラベルを付与
- kuromojiが初期化できない環境では軽量解析に自動フォールバック

## 重要

`kuromoji` は新規依存です。ZIP反映後は必ず以下を実行し、`package-lock.json` もGitHubにpushしてください。

```bash
npm install --legacy-peer-deps
npm run typecheck
npm run build
```

GitHub Actions は `npm ci --legacy-peer-deps` で動くため、`package-lock.json` の更新が必要です。
