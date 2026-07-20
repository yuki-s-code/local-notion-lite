# v435 Semantic Index revision cache invalidation

## Purpose

Keep related-page results fast without showing a stale "not indexed" or "no related pages" result after a Semantic Index rebuild or diff update.

## Changes

- Semantic Workspace Index now carries a `revision` token. Old index files safely use `generatedAt` as their revision.
- Related result responses carry the `indexRevision` used to calculate their results.
- Added a lightweight `GET /semantic/index-revision` endpoint. It reads the already-hydrated in-memory index and does not scan pages, databases, journals, or embeddings.
- The related panel validates its short-lived cache against the current index revision before reuse.
- Full rebuilds and diff updates dispatch a `local-notion:semantic-index-updated` event.
- Open related panels clear stale entries and refresh only their current target after that event.
- When a page is not yet in the index, the panel now explains that it is preparing related information instead of implying there are no related pages.

## Result

After a new page is indexed, its related information appears automatically. The user does not need to press the refresh button. Other pages are recalculated only when opened or currently visible.
