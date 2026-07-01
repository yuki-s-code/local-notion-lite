# v213 Retrieval Pipeline Reset

v213では、FAQ検索の精度問題を小さな個別ルールで補正するのではなく、回答までの検索パイプラインを実務向けに整理し直しました。

## 主な修正

- 会話履歴を常に検索クエリへ結合する処理を廃止
- 「それ」「その」「さっきの続き」など、省略質問のときだけ文脈を補完
- negativeTerms を identityEmbedding から除外
- negativeTerms は最終判定の除外・減点にのみ使用
- FAQ識別用Embeddingから answer 本文の影響を排除
- rule profile の誤マッチを修正
  - 例: 「学童」という語だけで減免ルールが発火しないように変更
- fee.general と fee.reduction を分離
- 主題一致ゲートを追加
- 質問主題とFAQ主題が不一致の場合、高信頼採用を禁止
- FAQ JSONの title / examples を保存対象に追加
- mode を `retrieval-pipeline-reset-v213` に更新

## なぜ修正したか

従来は以下の条件で誤回答が起きやすくなっていました。

1. 直前の会話履歴が無条件で検索文に混ざる
2. negativeTerms がEmbedding対象に入っていた
3. 費用と減免が同一Intentグループとして扱われる
4. answer本文の補足語がFAQ主題として扱われる
5. 主題が違ってもスコアが高ければ高信頼になる

v213では、Transformer.jsの意味検索は候補検索として活かしつつ、最終採用は主題・Intent・キーワード・除外語で安全確認します。

## 再生成が必要なファイル

起動後、運用パネルから以下を実行してください。

```txt
検索・意味ベクトル再生成
```

これにより、以下がv213構造で再生成されます。

```txt
smart-assist/search-index.json
smart-assist/semantic-index.json
```

## 期待される改善

```txt
学童クラブの費用はどれくらいですか
  → 放課後児童クラブの費用FAQ

減免について教えて
  → 放課後児童クラブの減免FAQ

有給はいつから取得できますか
  → 有給・年休の取得開始FAQ
```

