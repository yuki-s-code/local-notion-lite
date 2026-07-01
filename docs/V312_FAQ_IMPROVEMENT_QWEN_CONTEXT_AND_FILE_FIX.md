# V312 FAQ Improvement Qwen Context and File Fix

## Problem
Short test generation succeeded, but FAQ improvement still failed.
Logs showed that the final visible attempt used `llama-completion -p <long prompt>` with `n_ctx = 1024`, and the model returned no usable stdout.

## Cause
- Test prompt was short, so it fit in 512 context and returned quickly.
- FAQ improvement prompt was much longer and could exceed or nearly fill 1024 context.
- The fallback path for llama-completion still used `-p` with a long prompt.
- Qwen + llama-completion auto chat template could conflict with user-supplied long prompt.

## Changes
- For long prompts, context is automatically raised to at least 2048.
- Qwen + llama-completion now uses manual ChatML from a prompt file with `-f` and `-no-cnv`.
- FAQ improvement prompt was shortened for local 1.5B models.
- Final fallback for llama-completion no longer uses `-p <long prompt>`.
- Compact fallback is also written to a file and executed with `-f`.

## Expected result
FAQ improvement should no longer show `args: ... -p "次のFAQ..."` when llama-completion is used. It should show `-f <prompt-file>` and return JSON or parsed draft output.
