# V437 Semantic Index large-content safety

## Fixed risk

A single page, FAQ, journal, or database row could contain an image data URI,
base64 payload, or very long text. Previously that payload could reach the
Transformers.js WASM tokenizer without an explicit token limit and make a
workspace semantic rebuild fail or appear to stop.

## Safeguards

- Strip Markdown/HTML image sources, `data:`, `blob:`, and `file:` payloads.
- Remove opaque no-space tokens longer than 512 characters.
- Bound semantic extraction from properties, page text, FAQ text, DB rows, and journals.
- Bound the final embedding input to 1,800 characters.
- Call Transformers.js with `truncation: true` and `max_length: 512`.
- Preserve a previously valid embedding if a new embedding fails.
- Record failed embedding counts and up to 20 affected chunk IDs in build statistics.
- Skip one unreadable page instead of aborting the entire workspace rebuild.

## User-facing behavior

Images remain in pages. Their binary source is excluded from semantic indexing;
image alt text and ordinary surrounding prose remain searchable.
