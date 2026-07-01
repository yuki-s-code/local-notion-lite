# v307 llama-cli b9632 interactive early return fix

## Problem

`llama-cli` build `b9632` can generate the answer immediately, then remain in interactive mode waiting at the `>` prompt. In that case the terminal shows the answer quickly, but the app waits until the configured timeout before rendering the result.

Example:

```txt
こんにちは<|im_end|>
[ Prompt: ... | Generation: ... ]
>
```

## Fix

- Replaced plain `execFile` waiting behavior with a spawn-based runner.
- Keep collecting stdout/stderr while llama-cli runs.
- Detect that generation is complete when output contains:
  - llama.cpp performance line: `[ Prompt: ... | Generation: ... ]`
  - ChatML assistant completion with `<|im_end|>`
  - JSON code block output for compact fallback
- Once answer output is available, send `/exit` and return the parsed answer without waiting for the full timeout.
- Preserve timeout handling for true hangs.

## Expected behavior

The lightweight test should return `こんにちは` soon after it appears in the terminal, rather than waiting 60 seconds.
