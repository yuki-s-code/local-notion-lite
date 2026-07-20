# V281 Smart Assist model download fix

## Summary

Fixed Smart Assist AI model acquisition after the screen/service split and validation changes.

## Changes

- Added `modelRoot` to transformer settings/download validation schemas.
- Accepts `modelRoot`, `targetDir`, and `localModelPath` as model root inputs for backward compatibility.
- Made Hugging Face downloads more robust by using URL-safe redirects and User-Agent headers.
- Added optional downloads for `tokenizer.model` and `quantize_config.json`.
- Added additional ONNX filename candidates used by current ONNX repos:
  - `onnx/model_quantized.onnx`
  - `onnx/model_int8.onnx`
  - `onnx/model_uint8.onnx`
  - `onnx/model.onnx`
  - `onnx/model_fp16.onnx`
  - `onnx/model_q4f16.onnx`
- If a compatible quantized file is found under an alternate filename, it is saved locally as `onnx/model_quantized.onnx` so the existing runtime can load it.
- Updated Smart Assist default model to `sirasagi62/ruri-v3-70m-ONNX` consistently.

## Not changed

- package-lock.json
- GitHub Actions
- kuromoji/node-nlp
- Database/page link behavior
