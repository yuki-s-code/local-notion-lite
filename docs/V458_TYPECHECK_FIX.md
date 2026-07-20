# v458 Typecheck Fix

Fixes TypeScript errors introduced by persistent semantic rebuild job typing and Smart Assist tag hint inference.

- Explicitly types the local semantic rebuild job as the full union state shape, avoiding literal narrowing to `queued`.
- Explicitly types `tagHints` as `string[]` and its `Set` as `Set<string>`, so tag group map indexing and tag comparisons remain type-safe.

No runtime behavior changes.
