# V236 Configurable Transformer Model

Smart Assist 管理画面から Transformers.js モデルを設定・取得・確認できるようにしました。

## 追加内容

- Smart Assist 管理画面に「AIモデル」タブを追加
- モデルIDを変更可能
  - 既定: `Xenova/multilingual-e5-small`
- モデル保存先フォルダを変更可能
- 管理画面からモデル取得
- モデル確認
- semantic-index再生成導線
- `transformer-settings.json` に設定を保存
- `dtype: 'q8'` に統一
- E5系モデルでは `query:` / `passage:` prefix を自動付与

## 保存先

共有フォルダ側:

```txt
smart-assist/transformer-settings.json
```

例:

```json
{
  "modelId": "Xenova/multilingual-e5-small",
  "modelRoot": "D:\\LocalNotionModels",
  "dtype": "q8",
  "localFilesOnly": true
}
```

## モデル配置

モデル保存先を `D:\LocalNotionModels` にした場合:

```txt
D:\LocalNotionModels
  \Xenova
    \multilingual-e5-small
      config.json
      tokenizer.json
      tokenizer_config.json
      special_tokens_map.json
      \onnx
        model_quantized.onnx
```

## 注意

- `model_quantized.onnx` は100MBを超える場合があるため、GitHubリポジトリには含めません。
- GitHub Actionsではビルド時に既定モデルをダウンロードします。
- 管理画面から別モデルを指定した場合は、モデル取得後に semantic-index を再生成してください。
