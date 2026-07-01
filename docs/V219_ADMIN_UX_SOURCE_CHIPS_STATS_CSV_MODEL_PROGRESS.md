# v219 Admin UX / Source / Chips / Stats / CSV / Model Progress

## 追加内容

- チャット画面右側を小さな「ミニ管理」へ整理
- 詳細なSmart Assist管理画面を別モーダルに分離
- 出典/根拠を回答ごとに強制表示
- よくある質問チップをチャット上部に表示
- 質問ランキング統計を追加
- FAQ管理画面をタブ式に整理
- CSV取込/CSV出力を追加
- Transformers.jsモデルロード/ベクトル再生成の専用進捗表示を追加

## CSV列

```csv
id,status,category,question,answer,tags,likelyQuestions,paraphrases,negativeTerms,sourceTitle,sourcePage
```

`tags`, `likelyQuestions`, `paraphrases`, `negativeTerms` は「、」区切りで複数指定できます。
