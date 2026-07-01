# V243 Ruri model presets

Smart Assist の標準モデルを `sirasagi62/ruri-v3-70m-ONNX` に変更しました。

## 対応プリセット

- `sirasagi62/ruri-v3-70m-ONNX`（標準）
- `onnx-community/ruri-v3-30m-ONNX`（軽量）
- `Xenova/multilingual-e5-small`（多言語）

## 外部モデル配置

モデル保存先には、モデル提供者フォルダの親フォルダを指定します。

例: `D:\LocalNotionModels`

```txt
D:\LocalNotionModels
  ├─ sirasagi62
  │   └─ ruri-v3-70m-ONNX
  │       ├─ config.json
  │       ├─ tokenizer.json
  │       ├─ tokenizer_config.json
  │       └─ onnx
  │           └─ model_quantized.onnx または model.onnx
  ├─ onnx-community
  │   └─ ruri-v3-30m-ONNX
  │       └─ ...
  └─ Xenova
      └─ multilingual-e5-small
          └─ ...
```

## 操作

1. 管理画面 → AIモデル
2. モデルIDを選択
3. モデル保存先フォルダを指定
4. モデル確認
5. semantic-index再生成

`model_quantized.onnx` がある場合は q8 として読み込み、ない場合は `model.onnx` を使用します。
