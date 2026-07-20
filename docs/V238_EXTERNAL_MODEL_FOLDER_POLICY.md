# V238 External Model Folder Policy

Smart Assist は、本番・開発ともに外部フォルダの `Xenova/multilingual-e5-small` を標準モデルとして使用する。

## 方針

- 標準モデル: `Xenova/multilingual-e5-small`
- dtype: `q8`
- 使用ONNX: `onnx/model_quantized.onnx`
- EXEには大型ONNXモデルを同梱しない
- GitHub Actionsでもモデルをダウンロードして同梱しない
- WASMランタイムのみアプリに同梱する
- モデル本体はSmart Assist管理画面の「AIモデル」タブで指定した任意フォルダから読む

## 正しい配置

Windows例:

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

Mac開発例:

```txt
/Users/fujiwaraisamusei/Desktop/LocalNotionModels
  └─ Xenova
      └─ multilingual-e5-small
          ├─ config.json
          ├─ tokenizer.json
          ├─ tokenizer_config.json
          ├─ special_tokens_map.json
          └─ onnx
              └─ model_quantized.onnx
```

## 管理画面設定

```txt
モデルID: Xenova/multilingual-e5-small
モデル保存先フォルダ: D:\LocalNotionModels
```

指定するのは `Xenova` の親フォルダ。以下は誤り。

```txt
D:\LocalNotionModels\Xenova\multilingual-e5-small
D:\LocalNotionModels\Xenova\multilingual-e5-small\onnx
```

## 運用手順

1. 任意フォルダにモデル一式を配置する
2. Smart Assist管理画面を開く
3. AIモデルタブを開く
4. モデルIDに `Xenova/multilingual-e5-small` を入力する
5. モデル保存先フォルダに `Xenova` の親フォルダを入力する
6. 設定を保存する
7. モデル確認を実行する
8. semantic-indexを再生成する

## 注意

`model_quantized.onnx` が 134B 程度の場合は Git LFS のポインタファイルであり、本体ではない。実体はMB単位のファイルである必要がある。
