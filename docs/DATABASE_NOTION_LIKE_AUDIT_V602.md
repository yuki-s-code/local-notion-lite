# Database Notion-like table interaction audit (v602)

## Implemented

1. **Per-column table footer summaries**
   - Aggregation is selected from each column menu and persists per database in local storage.
   - Supported: count, non-empty, empty, unique, sum, average, median, minimum, maximum, range, checked, unchecked, completion rate.
   - Aggregations use the rows currently visible after the active view, filters, search and local sorting, matching the expected table-view mental model.
   - In Server Table mode, the footer explicitly reports that its scope is the currently loaded page. Full filtered-result aggregation must be implemented server-side, rather than pulling all rows into React.

2. **Column affordances**
   - A discreet column menu is now available from the table header.
   - It supports column hiding and footer aggregation selection without opening the large Properties or View panels.
   - Existing width adjustment, sort toggle, visibility management, bulk edit and row preview remain unchanged.

3. **Performance compatibility**
   - No rows are added to the DOM; the existing table virtualizer remains the rendering boundary.
   - No changes were made to row save, row link indexes, semantic index scheduling, or DB row task indexing.
   - Footer calculations are deliberately based on the already-renderable visible row collection.

## Existing functionality confirmed

- Inline property editing with debounced text commits and immediate discrete-value commits.
- Multi-row selection, bulk editing, duplicate, delete, CSV export/import.
- Property schema management, relation, rollup, formula, view-specific filters/sorts/grouping.
- Table virtual scrolling and optional SQLite server paging for large databases.
- Row detail drawer, row body editing, child pages, related items, database task indexing and semantic-index incremental updates.

## Next recommended implementation order

1. Persist table footer aggregation into `DatabaseView` instead of local storage, so it is shared with the saved database/view.
2. Add full-result server aggregation to `queryDatabaseRows` for Server Table mode; keep React limited to the visible page.
3. Add a dedicated `status` property with grouped states and task completion semantics.
4. Expand formula evaluation through a server-side dependency cache before adding advanced functions.
5. Add database sub-items/dependencies only after relation semantics and migration behavior are specified.
