# v292 Smart Assist Semantic Index Admin

## 概要

v292では、Smart Assist管理画面に **関連Index** タブを追加した。

Workspace Semantic Index は、ページ・FAQ・データベース行・Journal・資料要約を横断して関連候補を表示するための ruri-v3 インデックスである。

## 追加UI

Smart Assist管理画面に以下を追加した。

- 関連Index タブ
- Workspace Semantic Index の状態表示
- Indexed件数
- 最終生成日時
- エンジン名 / モデル名
- 種別ごとの件数
  - FAQ
  - ページ
  - DB行
  - Journal
  - 資料
- 状態更新ボタン
- 関連Index再生成ボタン

## 運用上の位置づけ

FAQ検索再生成と関連Index再生成は役割が異なる。

### FAQ検索再生成

Smart AssistがFAQ回答を返すための検索索引を再生成する。

回答精度に直接関係するため、FAQ追加・編集・承認後に実行する。

### 関連Index再生成

ページ、DB行、Journal、FAQを横断する関連表示用のインデックスを再生成する。

以下を大きく更新した後に実行する。

- ページ本文
- DB行
- Journal
- FAQ
- モデル設定

## UX方針

関連表示は回答の断定根拠ではなく、実務者が確認するための上位候補として扱う。

そのため、Smart Assist回答そのものはFAQ中心を維持し、関連Indexは次の用途に使う。

- ページ右サイドバーの関連表示
- DB行詳細の関連表示
- Journalの関連表示
- Smart Assist回答後の参考候補

## 変更ファイル

- `src/renderer/src/components/screens/SmartAssistScreen.tsx`
- `src/renderer/src/styles/app.css`
- `docs/V292_SMART_ASSIST_SEMANTIC_ADMIN.md`
- `README.md`
