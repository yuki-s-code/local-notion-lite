# Semantic / Related Index child-page synchronization audit (v621)

## Scope
Verified automatic index maintenance for ordinary pages, database rows, row bodies, and database-row child pages.

## Fixed paths

### Database-row child page creation
- The server already creates the page and refreshes the parent row's link index while persisting the generated child-page reference.
- The renderer now schedules only two semantic sources: `page:<childPageId>` and `database_row:<databaseId>:<rowId>`.
- Both are deduplicated by the existing idle queue and processed in batches of 20. No workspace-wide page/row scan is triggered.

### Database-row child page rename / content edits
- Normal page save continues to refresh the child page itself.
- When the saved page has `parentId = database-row:<databaseId>:<rowId>`, the parent DB row is also added to the semantic queue.
- This follows the server-side title synchronization that rewrites the generated child-page link in the row body and updates its link index.

### Database-row child page deletion
- Both deletion surfaces (row-body editor and database sidebar) now enqueue the removed page and its parent DB row.
- Targeted semantic replacement returns no chunks for a trashed page, which removes that page's stale chunks without rebuilding unrelated sources.
- The parent DB row is re-embedded after its generated link is removed.

### Ordinary page creation, duplication, trash, and moves
- New and duplicated pages are queued immediately.
- Trashing queues an empty replacement for the page. If it was a DB-row child, the parent row is also refreshed.
- Moving a page queues the page and any old/new database-row parent, preserving correctness when a page is detached from a DB row.

### Database structural changes and deletion
- DB-row semantic refresh now includes row IDs removed by a save; empty targeted replacements delete stale row chunks.
- A DB title/property change queues all of that DB's rows because row semantic text includes DB title/property labels. Pure view/layout changes do not trigger it.
- Deleting a database queues its former row IDs for targeted chunk removal.

## Efficiency guarantees
- Normal page/row/child-page operations only enqueue affected semantic sources.
- Queue keys deduplicate repeated saves; processing is limited to 20 sources per pass.
- Index creation remains explicit: automatic updates do not create a first-time workspace index.
- Full workspace scans remain reserved for explicit full rebuilds or untargeted maintenance.

## Validation
- TypeScript syntax transformation passed for all changed renderer files.
- Full `npm run typecheck` cannot run in the extracted source because `@types/electron` and `@types/node` are absent from the ZIP.
