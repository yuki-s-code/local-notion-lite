# Database Table UX Audit v603

## Fixed: hidden columns could not be restored from the table workflow

`hiddenColumns` is intentionally stored in `localStorage` per database (`fast-db-hidden:<databaseId>`), so it is a local display preference and does not alter shared database data. The prior implementation allowed a header menu to hide a column but did not provide a table-visible recovery route.

### v603 changes

- Added **表示するプロパティ** to the existing **表示・View** panel.
  - Lists every property, including hidden columns.
  - Toggle restores a hidden column immediately.
  - **すべて表示** clears only the local visibility map.
  - The panel states explicitly that this is device-local and does not modify shared data.
- The top toolbar now shows `表示・View visible/total（非表示 n）`, so hidden columns are discoverable without opening Properties first.
- A guard prevents the last visible column from being hidden. This avoids an unusable zero-column table.
- The header menu uses the same guard and explains why the final column cannot be hidden.
- Removed a duplicate Large DB Mode banner rendered twice by `DatabaseToolbar`.

## Kept deliberately local

The following remain local (`localStorage`) because the user chose per-device settings and because shared-folder write traffic should not be increased for view cosmetics:

- hidden columns
- column widths
- footer aggregate selection
- large DB display setting
- server page size
- row preview width

## Recommended next implementation

1. **Server-side aggregate endpoint** for large tables, so a footer can report the full filtered result rather than only the loaded page.
2. **Status property** with Notion-like groups (`未着手 / 進行中 / 完了`) and direct task-index integration.
3. **Formula evaluation cache** on the server, preventing repeated renderer-side calculations for large databases.
4. **Nested AND/OR filter groups** after the performance path is server-backed.

The current change avoids global data writes and does not touch database row, semantic, link, task, or analysis index update paths.
