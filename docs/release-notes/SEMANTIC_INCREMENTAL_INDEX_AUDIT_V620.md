# V620 Semantic Incremental Index Audit

## Implemented

- Autosave Semantic updates now send typed targets (`page`, `database_row`) instead of only chunk priorities.
- Targeted updates read only the edited page or DB-row body. They no longer open every page and every DB-row content file before embedding.
- Semantic index writes preserve unrelated prior chunks and atomically replace/delete only the targeted source key.
- Added `pages(parent_id)` SQLite index, which makes DB-row child-page lookup indexed.

## Deliberate boundaries

- Full rebuild and admin diff update without targets still scan the workspace so global additions/deletions are detected.
- Targeted DB-row updates still load database/page/journal metadata for Relation/Rollup labels, but not unrelated DB-row body files.
- Existing DB-row -> page link index is already correctly stored as `target_type = page` in the current source; no corrective change was applied there.

## Next candidate

- Add source-targeted updates for child-page creation/rename/delete, so the affected parent DB row is queued for Semantic refresh immediately.
