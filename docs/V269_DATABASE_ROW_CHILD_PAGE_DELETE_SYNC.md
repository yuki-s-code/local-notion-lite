# V269 Database Row Child Page Delete Sync

## Summary

This version makes DB-row child page deletion go through one shared path so the row preview and database sidebar tree stay in sync.

## Changes

- Added a shared server API for DB-row child page deletion:
  - `DELETE /databases/:id/rows/:rowId/child-pages/:pageId`
- Added `VaultService.deleteDatabaseRowChildPage()`.
- Added `ApiClient.deleteDatabaseRowChildPage()`.
- The API removes the child page reference from DB-row content and, by default, moves the child page to the page trash.
- The DB-row preview now has a delete button beside each child page.
- The database sidebar tree now has a delete button beside each child page.
- Both UI surfaces dispatch and listen for `local-notion:database-row-child-page-removed`.
- Existing `local-notion:page-tree-mutated` refreshes are also respected.

## Result

Deleting a DB-row child page from either the sidebar tree or the row preview updates both views and removes stale child page references.

## Not changed

- package-lock.json
- GitHub Actions
- kuromoji
- node-nlp
