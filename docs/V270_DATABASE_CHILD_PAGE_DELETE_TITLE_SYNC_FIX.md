# V270 Database child page delete/title sync fix

## Summary

Fixes two database-row child page synchronization problems:

1. Child-page delete could fail with HTTP 400 when the sidebar held a stale database/row reference.
2. Child-page title edits were not consistently reflected in both the database row preview and database sidebar tree.

## Changes

- Encoded database, row, and page ids in the renderer API client for DB row content/sidebar/child-page routes.
- Made `deleteDatabaseRowChildPage()` idempotent:
  - Always removes the page id from DB row content references.
  - Trashes the page if it still exists.
  - Does not fail if the database or row was already stale/missing.
- Made `listDatabaseRowSidebarChildren()` return an empty list instead of throwing for stale DB/row references.
- Cleans stale child page ids from row content when sidebar children are fetched.
- Dispatches page update events after page save so DB row preview and DB sidebar tree can refresh titles.
- Adjusted sidebar/preview refresh handling so title updates update cached labels, while trash/delete events remove them.

## Not changed

- package-lock.json
- GitHub Actions
- kuromoji/node-nlp
