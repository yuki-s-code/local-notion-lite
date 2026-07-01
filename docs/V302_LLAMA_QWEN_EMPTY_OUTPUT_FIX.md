# v302 llama.cpp Qwen empty output fix

## Summary

v302 fixes a case where llama.cpp launches successfully from Local Notion Lite but the application reports `生成結果が空でした。`.

This happened most often with Qwen Instruct GGUF models when the prompt was passed as a plain text file. Some llama.cpp / Qwen combinations may immediately return EOS unless the prompt is wrapped in ChatML.

## Changes

- Wrap Qwen model prompts in ChatML:
  - `<|im_start|>system`
  - `<|im_start|>user`
  - `<|im_start|>assistant`
- Clean model output by removing ChatML / EOS tokens.
- Preserve the v299 prompt-file execution method.
- Preserve detailed diagnostics for stdout / stderr / exit code.

## Why

Terminal tests can pass with a short prompt, while the application prompt can still return empty output because the FAQ improvement prompt is longer and instruction-style. Qwen Instruct models are more stable when given ChatML formatting.

## Recommended test settings

For first app-side generation test:

- Model: Qwen2.5 1.5B Q4_K_M
- Context: 1024
- Max tokens: 128 or 256
- Temperature: 0.1

After confirming generation works, increase context and max tokens gradually.
