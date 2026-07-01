# v140 Local Generative Assist + FAQ/PDF JSON Bridge

## 目的
OllamaやクラウドAIを使わず、FAQ・ページ・DB・Journal・PDF由来FAQを根拠にして、生成AI風の回答を完全ローカルで組み立てる。

## 追加内容

- Local Generative Assist
  - 質問意図を分類: 定義 / 手順 / 要約 / 比較 / TODO / 期限 / 一覧 / FAQ
  - FAQ・ページ・DB・Journal・PDF由来FAQを横断検索
  - 根拠文を抽出し、回答テンプレートで自然な回答に近づける
  - 信頼度スコアを表示

- FAQ JSON Import / Export
  - ChatGPT等で作成したPDF FAQ JSONを取り込める
  - FAQをJSONとして書き出せる
  - `question` / `answer` のほか、`sourcePdfName` / `sourcePage` / `sourceText` に対応

- 直近回答のFAQ化
  - チャット回答を下書きFAQとして保存
  - 共有フォルダ `smart-assist/faq-items.json` に保存

## 想定運用

1. 重要PDFはChatGPTに読ませて高精度FAQ JSONを作る
2. Local Notion LiteへFAQ JSONをインポートする
3. 日常利用ではLocal Generative Assistに質問する
4. 良い回答は「直近回答をFAQ化」でFAQとして育てる

## 注意
これは大型生成AIではない。回答はローカル検索・重要文抽出・FAQ検索・テンプレート生成で構成するため、最終判断は参照元を確認する。
