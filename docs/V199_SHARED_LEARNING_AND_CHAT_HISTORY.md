# v199 Shared Learning and Chat History

## 目的
v198の汎用FAQエンジンを維持しながら、運用パネルの表示をコンパクト化し、学習データ共有、会話履歴削除、過去履歴を踏まえた継続会話を追加しました。

## 変更点

- 右サイドのステータス表示をチップ化し、重複表示を削除。
- 運用パネル内に「この端末の履歴削除」「共有ログ削除」を追加。
- チャット入力欄付近に「履歴を元に続ける」チェックを追加。
- `/smart-assist/chat/ask` に直近会話 context を送信し、短い追質問でも前文脈を検索に反映。
- 共有フォルダの `smart-assist/chat-logs.json` を削除できる API を追加。
- node-nlp再学習時に `smart-assist/nlp-training-summary.json` を出力し、共有学習状態を確認可能に変更。

## 共有されるもの

```txt
共有フォルダ/
  smart-assist/
    faq-items.json
    synonyms.json
    rule-profiles.json
    chat-logs.json
    nlp-training-summary.json
```

node-nlpの実行モデル自体は各端末のメモリ上で作られますが、学習元となるFAQ・言い換え辞書・汎用ルールが共有フォルダにあるため、各端末で再学習すれば同じ知識を利用できます。

## 履歴の扱い

- 「この端末の履歴削除」: 画面に残っているローカル履歴だけを削除します。
- 「共有ログ削除」: 共有フォルダの `chat-logs.json` を空にします。他端末にも影響します。
- 「履歴を元に続ける」ON: 直近の会話を質問と一緒にAPIへ送り、過去文脈を踏まえて検索します。
