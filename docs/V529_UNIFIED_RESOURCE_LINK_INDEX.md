# V529: Unified resource relationship index

Pages, database rows, and database-row child pages now share `workspace_link_index`.

- Page -> page and page -> DB row links are indexed during page save/import.
- DB row -> page, DB row -> DB row, and structural DB row -> child page links are indexed during row save/import.
- Existing local indexes are rebuilt once when the DB-row links panel is first opened after upgrade.
- The migration adds typed target columns while preserving existing page-link records.
