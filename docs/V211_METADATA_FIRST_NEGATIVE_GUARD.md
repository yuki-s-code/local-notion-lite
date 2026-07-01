# v211 Metadata-first Negative Guard

## 目的
Transformer意味検索で、FAQ本文に含まれる関連語が過剰に効いて、別FAQが高信頼になる問題を修正しました。

例:

- 質問: `減免について教えて`
- 誤回答: 一般費用FAQ
- 原因: 一般費用FAQの answer に「減免制度について知りたい場合...」が含まれていたため

## 修正内容

- `negativeTerms` を最終ランキングで実際に使用
- 質問語がFAQの `negativeTerms` に一致した場合、そのFAQを強く減点
- `question / keywords / examples / testQuestions / tags / intent / category` を「メタ情報」として扱い、answer本文とは分離
- 質問タイプ判定をanswer本文ではなくメタ情報中心に変更
- Transformer意味検索だけで高信頼にならないよう、メタ情報一致がない場合は高信頼を抑制

## 運用ポイント

FAQ本文には関連トピックを含めても構いませんが、別FAQとして分けたい語は `negativeTerms` に入れてください。

例:

```json
{
  "intentId": "afterschool.fee",
  "keywords": ["費用", "料金", "利用料"],
  "negativeTerms": ["減免", "免除", "非課税", "生活保護", "兄弟割引"]
}
```

これにより、`減免について教えて` は一般費用FAQではなく、減免FAQへ寄りやすくなります。
