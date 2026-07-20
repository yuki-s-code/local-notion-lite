# v158 Empty State / Unanswered FAQ

## 目的
Local Generative Assistを、回答できなかった質問も蓄積してFAQへ育てられる画面にしました。

## 追加内容
- FAQが少ない場合に初回ガイドを表示
- 根拠が弱い回答の後に、未回答FAQとして保存する導線を追加
- 未回答FAQボックスを右パネルへ追加
- おすすめ質問に「未回答FAQを確認して」を追加
- FAQ JSON取込・手動作成への導線を空状態に配置

## 保存仕様
未回答FAQは通常FAQと同じ共有FAQとして保存されます。
category は `未回答FAQ`、tags は `未回答` / `要確認`、status は `draft` です。
