# v563 Journal restore: immediate index repair

## Fixed

Restoring a deleted Journal from Backup Center now repairs all lightweight
runtime indexes immediately:

- `journal_summary_index` for Journal lists and the Home dashboard
- `task_index` for checkbox tasks inside the restored Journal
- `workspace_summary_cache` for counts and recently updated Journal cards

The restored Journal directory is copied as a whole, which also preserves any
future Journal-local assets or metadata rather than restoring only `journal.json`.

## Why

The application deliberately serves Journal lists from SQLite when a summary
index exists. Restoring the JSON file alone could leave the restored Journal
invisible until a full resync/rebuild happened.
