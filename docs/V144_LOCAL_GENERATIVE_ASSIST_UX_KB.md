# v144 Local Generative Assist UX / FAQ Knowledge Base

## 目的

Local Generative Assist の上部ガイドが縦に伸びすぎる問題を解消し、FAQの全体像を見やすくしました。

## 変更内容

- チャット画面上部の「質問 / 根拠 / 育成」ガイドをコンパクトな横長ピルUIへ変更
- チャット本体のレイアウトを `auto / 1fr / auto` に変更し、上部ガイドが会話領域を圧迫しにくい構成へ変更
- 右サイドバーに FAQナレッジベース を追加
- FAQをカテゴリ別・PDF別に集計表示
- カテゴリやPDF名をクリックするとFAQ一覧をその条件で絞り込めるように変更

## 保存形式

FAQ本体の保存形式は v139 以降と同じく共有フォルダ `smart-assist/faq-items.json` です。
