# V237 Multilingual-e5-small 方針

Smart Assist の標準埋め込みモデルを `Xenova/multilingual-e5-small` に固定方針とする。

## 運用方針

- 既定モデルID: `Xenova/multilingual-e5-small`
- dtype: `q8`
- 必須ONNX: `onnx/model_quantized.onnx`
- 英語専用モデルはプリセット対象外
- E5系モデルでは embedding 入力に自動で prefix を付ける
  - query: `query: ...`
  - passage: `passage: ...`

## 任意フォルダ配置例

```txt
D:\LocalNotionModels
  └─ Xenova
      └─ multilingual-e5-small
          ├─ config.json
          ├─ tokenizer.json
          ├─ tokenizer_config.json
          ├─ special_tokens_map.json
          └─ onnx
              └─ model_quantized.onnx
```

管理画面では次を指定する。

```txt
モデルID: Xenova/multilingual-e5-small
モデル保存先フォルダ: D:\LocalNotionModels
```

`モデル保存先フォルダ` は `Xenova` の親フォルダを指定する。

## 操作順

1. AIモデル設定でモデルIDと保存先を設定
2. 設定を保存
3. モデル確認
4. OKなら semantic-index を再生成

## 注意

`model_quantized.onnx` は100MBを超えるため、GitHubリポジトリには含めない。
GitHub Actionsではビルド時にHugging Faceから取得する。
