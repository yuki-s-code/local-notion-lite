# Offline Transformers.js models

Smart Assist v236 can use either:

1. a model downloaded from the Smart Assist admin screen to an arbitrary folder, or
2. a packaged model under `resources/models`.

Default packaged model path:

```txt
resources/models/Xenova/multilingual-e5-small/
  config.json
  tokenizer.json
  tokenizer_config.json
  special_tokens_map.json
  onnx/
    model_quantized.onnx
```

Large ONNX files should not be committed to GitHub. The Windows GitHub Actions workflow downloads the default model before packaging.
