# V339 Database Index Management UI

## Summary
Adds explicit Database Index administration controls so the v337/v338 database SQLite indexes can be inspected and rebuilt from the UI.

## Why
v338 introduced `database_row_property_index` for faster filter/sort paths, but there was no clear user-facing management entry point. This caused confusion around where to run the index rebuild.

## Added
- `GET /database-index/status`
- `POST /database-index/rebuild`
- API client methods:
  - `getDatabaseIndexStatus()`
  - `rebuildDatabaseIndexAll()`
- Smart Assist settings buttons:
  - Database Index確認
  - Database Index再構築
- Status panel showing:
  - DB summary rows
  - DB row index rows
  - property value index rows
  - FTS rows
  - stale/missing DB count
  - last indexed time

## Notes
This index remains a rebuildable cache. The source of truth is still the database JSON files. If the status shows stale/missing entries, run Database Index再構築.
