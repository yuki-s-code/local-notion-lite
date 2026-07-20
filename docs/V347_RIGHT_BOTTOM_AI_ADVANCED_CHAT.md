# v347 右下AIチャット高機能化

右下AIアイコンから開くAIパネルを、検索候補表示だけでなく、実務用AIアシスタントとして使えるようにしました。

## 追加内容

- 回答モード切替
  - 標準
  - 短く
  - 詳しく
  - 手順化
  - 根拠重視
  - FAQ形式
- 対象範囲切替
  - ワークスペース全体
  - このページ
- 現在開いているページの本文をAI文脈として利用
- 参照候補カードに操作を追加
  - 使う
  - 除外
- 固定/除外した参照元を次回回答に反映
- 生成AIがONの場合は `/semantic/chat-answer` で回答文を生成
- 生成AIがOFF/失敗の場合は検索結果ベース回答へfallback
- 右下AI内から従来のAI横断検索へ遷移可能

## API

- `POST /semantic/chat-answer`

入力例:

```json
{
  "question": "このページを要約して",
  "answerMode": "detail",
  "pageContext": {
    "id": "page-id",
    "title": "ページタイトル",
    "markdown": "本文"
  },
  "pinnedSourceKeys": [],
  "excludedSourceKeys": []
}
```

## 方針

- 右下AIはNotion風のチャット入口として使う
- AI横断検索は詳細検索画面として残す
- 生成AIが遅い/未設定の環境でも使えるように検索ベース回答へfallbackする
- v346の1回起動方式/llama-server常駐方式の切替をそのまま利用する
