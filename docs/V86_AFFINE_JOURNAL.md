# v86 AFFiNE風Journal

## 目的
v85の単純な日付メモから、AFFiNEのJournal/Daily Notesに近い「日付を軸にしたワークスペース」へ改善しました。

## 追加内容
- Journal専用画面
- 上部の週カレンダー
- 今日へ戻る、前日/翌日、前週/次週
- メモが存在する日のドット表示
- 日付クリックで自動作成/表示
- BlockNoteによるDaily Note本文
- 右側にその日に作成/更新された関連ページ
- 最近のJournal一覧

## 保存形式
従来どおり以下です。

```txt
journals/YYYY-MM-DD/journal.json
```

## 方針
通常ページとは分けつつ、BlockNote本文・@リンク・DB参照と連携しやすい構成を維持します。
