# V678: Page-save coordinator and CSS second-stage cleanup

## Page save
- `PageSaveCoordinator` now owns the save ordering: conflict check, no-op/checkpoint handling, bundle creation, durable persistence, derived-index refresh, and history checkpoint.
- `VaultService.savePage()` remains the compatibility entry point and delegates to the coordinator.
- SQLite page row, FTS, link/task/attachment derived indexes, and database-child title synchronization stay in one post-write boundary so save ordering does not change.

## CSS
- Active page-context, bookshelf, shelf picker, and knowledge-garden selectors now use role-oriented names rather than release-number suffixes.
- Garden styles live in `knowledge-map.css`; stale first-generation bookshelf/open-shelf rules were removed from `bookshelf.css`.
- Existing older feature styles are intentionally left for a later, component-by-component migration to avoid an unbounded visual-regression change.
