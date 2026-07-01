# v303 llama.cpp Qwen CLI invocation fix

## Summary

v302 still returned an empty generation result on some llama.cpp builds even though `llama-cli` worked from Terminal.

v303 changes Qwen model execution to follow the Qwen/llama.cpp non-interactive pattern more closely:

- Use ChatML prompt via `-p` for Qwen models.
- Add `-sp` so special tokens are handled correctly.
- Stop using `--no-display-prompt` for Qwen by default.
- Keep `-f` as a fallback only.
- Combine stdout and stderr before cleaning so output is not missed.
- Strip ANSI/log lines and extract the JSON object when possible.
- Add a final compact `-p` fallback if ChatML returns no usable text.

## Recommended first test

Use:

- Qwen2.5 1.5B
- context: 1024
- max tokens: 128 or 256
- temperature: 0.1

