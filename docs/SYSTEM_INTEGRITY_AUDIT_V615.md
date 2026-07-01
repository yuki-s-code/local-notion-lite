# v615 System integrity and performance fixes

## Fixed
- Semantic DB-row refresh no longer truncates after 16 rows. The renderer keeps a deduplicated queue and processes 20 rows per background batch; remaining rows are automatically scheduled.
- Semantic change detection uses `row.updatedAt`, avoiding per-save `JSON.stringify` across every row and cell.
- DatabaseTable accepts same-database external revisions without resetting local layout, selection, undo history, or scroll. Pending local debounce edits are protected from overwrite.
- Bidirectional same-DB Relations now synchronize the normalized `nextValue`, preventing an invalid sub-item parent selection from leaving a reverse-only relation.
- Existing Unique IDs are backfilled in O(N), not O(N²).
- Removed obsolete `src/server/app.ts.bak` from the source tree.

## Remaining architecture work
1. Row-level PATCH APIs are still the next major performance improvement; normal cell edits currently send a whole DB snapshot.
2. Server Table with sub-items is intentionally disabled. A parent-id index plus ordered server query is needed before enabling it safely.
3. Workspace refresh paths should be consolidated behind one priority coordinator to avoid refresh races on slow shared folders.
4. Database statistics still scan rows in normal table mode; server aggregates should become the default for very large DBs.
