# v244 AIモデル保存先フォルダ選択

- Smart Assist 管理画面の AIモデル設定に「フォルダを選択」ボタンを追加。
- Electron のフォルダ選択ダイアログからモデル保存先フォルダを選べる。
- 手入力も引き続き可能。
- 選択するフォルダは `sirasagi62` / `Xenova` / `onnx-community` などの提供者フォルダの親フォルダ。

例:

```txt
/Users/name/Desktop/models
  └─ sirasagi62
      └─ ruri-v3-70m-ONNX
          └─ onnx
              └─ model.onnx
```

管理画面で選択するのは `/Users/name/Desktop/models`。
