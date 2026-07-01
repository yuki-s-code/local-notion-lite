# v309 llama-completion single-turn fix

## Problem
v308 switched from `llama-cli` to `llama-completion`, which removed the 60 second REPL wait. However, `llama-completion` still entered conversation/interactive mode and the UI treated startup/performance logs as the generated answer.

## Fix
- Use `llama-completion` with `-st` / `--single-turn` behavior so one prompt is processed and the process exits.
- For `llama-completion`, pass the user prompt via `-p` and the system message via `-sys` instead of manually embedding ChatML.
- Add `--log-disable`, `--no-perf`, and `--no-display-prompt` to reduce stdout/stderr noise.
- Add fallback variants that remove log suppression or disable conversation mode if the build behaves differently.
- Strengthen output cleanup so timestamped `I` logs, sampler logs, and `common_perf_print` are not treated as answers.

## Expected test result
The generation test should show only:

```text
テスト生成OK: こんにちは
```

or a short JSON/text response, not `system_info`, `sampler params`, or `common_perf_print` logs.
