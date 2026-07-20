# v235 Offline Transformers.js Packaging

## 目的

庁内・ローカル・オフライン端末で Smart Assist の意味検索を動かすため、Transformers.js のモデルと ONNX WASM をアプリに同梱できる構成にした。

## 追加内容

- `resources/models` を Electron `extraResources` に追加
- `resources/wasm` を Electron `extraResources` に追加
- 実行時に `env.localModelPath` を自動設定
- `env.allowRemoteModels = false`
- `env.allowLocalModels = true`
- GPU前提ではなく CPU/WASM 実行を前提化
- `/smart-assist/transformer-runtime` でモデル配置状況を確認可能
- `npm run prepare:transformer-resources` を追加
- `npm run check:transformer-resources` を追加

## EXEにモデルは含まれるか

含まれる。ただし、ビルド前に実体ファイルが `resources/models` 配下に存在している必要がある。

```txt
resources/models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/
  config.json
  tokenizer.json
  tokenizer_config.json
  special_tokens_map.json
  onnx/
    model_quantized.onnx
```

この状態で `npm run dist:win` または `npm run build:win:ci` を実行すると、electron-builder の `extraResources` によりインストール後の `resources/models` に同梱される。

## WASM

`npm install` 後に以下を実行する。

```bash
npm run prepare:transformer-resources
```

これにより `node_modules/onnxruntime-web/dist` から `resources/wasm` へ `.wasm` をコピーする。

## 確認

```bash
npm run check:transformer-resources
npm run build:win:ci
```

`check:transformer-resources` が失敗する場合、EXE化してもオフライン意味検索は動かない。

## 注意

このZIPにはモデル実体は含めていない。モデルファイルは容量が大きく、ビルド前に `resources/models` へ配置する運用にしている。
