# V349 AI Chat Mojibake / Related Action Fix

## Summary

This release fixes two issues found in the right-bottom AI chat panel.

## 1. Japanese mojibake in generated answers

`runLlamaProcessOnce()` previously decoded each stdout/stderr chunk with `Buffer.toString('utf8')` immediately.
When a Japanese multibyte character was split across process chunks, decoding per chunk could produce replacement characters such as `���約`.

V349 now uses `StringDecoder('utf8')` for stdout/stderr so incomplete multibyte sequences are carried across chunks and decoded only when complete.

A safety guard was also added: if a generated answer still contains obvious replacement-character mojibake, the UI receives the deterministic page/search fallback answer instead of the broken generated text.

## 2. “Find related info for this page” used normal search

The right-bottom AI action `このページに関連する情報を探して` previously built a query from the question/page text and called normal workspace semantic search.
This could surface weak FAQ candidates that were not truly related to the current page.

V349 now routes page-related intent to `getWorkspaceSemanticRelated({ type: 'page', id })`, using the current page semantic chunk as the search target.

## Expected behavior

- `このページを要約して` should no longer display `���` mojibake caused by chunk-split decoding.
- If mojibake is still detected, the app falls back to page-body based output with a short warning.
- `このページに関連する情報を探して` should show candidates related to the current page, not just candidates matching the instruction text.
