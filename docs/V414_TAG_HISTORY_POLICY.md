# v414 Tag history policy

Tag changes are saved immediately but do not create page history checkpoints.

A history checkpoint is still created for title, icon, scope, or non-tag property changes; manual saves and automatic checkpoints retain their existing behavior.

## Rationale

Tags are classification metadata. Bulk tag cleanup or suggestion acceptance can touch many pages, and recording a full content snapshot for each tag-only change makes history noisy without helping restore meaningful document states.

## AI synonym linkage

Smart Assist synonyms and tag aliases should not be merged into one unrestricted list. A Smart Assist synonym can be ambiguous or category-oriented, while a tag alias must map deterministically to exactly one tag. The recommended future implementation is to let a tag alias optionally reference a Smart Assist synonym entry, while preserving the tag-specific one-to-one mapping.
