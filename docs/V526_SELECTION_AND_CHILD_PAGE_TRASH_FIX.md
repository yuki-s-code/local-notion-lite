# V526: Workspace selection and database-row child-page trash consistency

## Fixes

1. Sidebar selection is now mutually exclusive.
   - When a database workspace tab is active, page-tree and favorite-page selection are cleared.
   - When a page workspace tab is active, only that page is highlighted.

2. Trashing a database-row child page through the normal page trash action now updates all DB-row body representations.
   - Removes the child-page ID from `childPageIds`.
   - Removes generated `@[[title|page-id]]` Markdown references.
   - Removes matching `local-page://page-id` BlockNote inline links and empty generated paragraphs.

3. An open database-row BlockNote body refreshes after its child page is trashed.
   - Refresh runs only for the matching DB row.
   - Refresh does not overwrite a dirty or currently-saving local draft.

## Rationale

DB-row child pages are represented by both a relationship list and a visible link in the row body. The old generic page-trash route only removed the relationship list, leaving a dead visible link. The updated server cleanup is idempotent and is used by both normal page trash and sidebar child-page deletion.
