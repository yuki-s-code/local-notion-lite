# V514 Database Workbench Tabs

## Purpose

Database navigation now uses workbench tabs without creating multiple simultaneously editable `DatabaseTable` instances.  This retains the existing database lock, conflict, autosave, SQLite paging, and row-detail behavior.

## Behavior

- Opening a database from the sidebar, a relation, or an embedded database adds a database tab.
- Opening a row adds a dedicated row-detail tab and opens the existing row preview drawer.
- Database tabs can be reordered, pinned, closed, and restored per PC from localStorage.
- The current database's saved views appear in a second, compact view bar. Opening a view makes it the active visual state for the tab without duplicating database data.
- A maximum of 12 unpinned tabs is retained. Pinned tabs remain available until explicitly closed.

## Shared-folder safety

Only one `DatabaseTable` is mounted at a time.  A tab switch invokes the established `openDatabase()` path, which flushes queued saves, releases the prior database lock when required, reloads the selected database, and preserves the existing conflict handling.

This is intentionally not a real-time multi-table editor. It is designed for offline, SMB/NAS shared-folder use where predictable saves are more important than concurrent editing.
