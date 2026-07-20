# V438 Long-document semantic indexing

## Purpose

Make the local Semantic Index suitable for operational documents whose relevant information appears beyond the opening section, without sending image data, base64 data, or unbounded text into the ONNX embedding model.

## Design

- Source prose is cleaned before indexing. `data:`, `blob:`, `file:` payloads, media HTML, markdown image URLs, control characters, and opaque 512+ character tokens are excluded.
- Pages, database row prose, and journals are split by paragraph and sentence boundaries.
- Each chunk is approximately 1,080 characters with a 160-character overlap. This preserves context over chunk boundaries.
- A source has at most 40 chunks (about 43,000 characters plus a final tail chunk). This bounds CPU time and local-index size while keeping both opening and closing sections searchable.
- Each generated item retains `sourceId`, `chunkIndex`, and `chunkCount`. Search can return a precise matching passage; the related-page panel compacts duplicate chunks to one card per source.
- Full builds yield to Node every four new embeddings so Electron remains responsive. A failed chunk does not invalidate an existing usable embedding or the whole index.

## Migration

The semantic engine identifier changed to `workspace-semantic-ruri-v3-v3-chunked`. The prior index is intentionally treated as incompatible. Run **Semantic Index → Full rebuild** once after updating. The local SQLite cache is upgraded non-destructively with `chunk_index` and `chunk_count` columns.

## Operational behavior

- A normal saved-page diff update still prioritizes `page:<id>`; all generated chunks for that page inherit the priority.
- Full rebuild is required once for existing long pages.
- Diff updates then only embed chunks whose content hash changed.
- The index remains a derived, rebuildable local search artifact. Page JSON/Markdown remains the source of truth.

## Limits

The 40-chunk cap is a stability guard. Documents longer than roughly 43k characters retain the final section but not every middle passage. Such documents should generally be split into logical child pages or source documents when exhaustive retrieval is required.
