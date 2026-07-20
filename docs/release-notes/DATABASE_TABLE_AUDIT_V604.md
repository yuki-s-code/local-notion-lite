# Database table audit / V604

## Implemented: exact footer aggregation for large server-paged tables

### Problem
In Server Table mode, only the current page (typically 120 rows) reaches the renderer. The previous footer therefore calculated totals such as `sum`, `average`, `unique`, and checkbox completion rate against that page only. For large databases this differed from Notion-style view totals and could be materially misleading.

### Design
- Added `POST /databases/:id/aggregates`.
- The endpoint applies the selected view filters and the current table search on the server, then returns only compact per-property values.
- The renderer requests aggregates only when at least one visible column has a configured footer aggregate.
- Requests are debounced by 180 ms, so search typing and menu changes do not create a request per keystroke.
- No rows are added to the renderer; virtual scrolling and server paging remain intact.
- Footer settings remain localStorage-only, as requested.

### Supported aggregates
`count`, `filled`, `empty`, `unique`, `sum`, `average`, `median`, `min`, `max`, `range`, `checked`, `unchecked`, `percent_checked`.

### Formula / Rollup
Formula and Rollup values can depend on renderer-only evaluation and related databases. This version does not fabricate a server value for them. When selected in server mode, the footer safely retains its current-page calculation and shows a tooltip explaining the scope.

## Whole-code audit findings retained as next priorities

1. **Status property and task semantics**
   Add a dedicated `status` property (not merely `select`) with status groups. Integrate it with task extraction, board grouping, and deadline views.
2. **Server-side Formula / Rollup evaluation**
   Needed before Formula/Rollup can participate in exact full-result footer aggregation, server filtering, and sorting without fallback.
3. **Nested filter groups**
   Current view filters are flat AND conditions. Add a recursive `AND/OR` filter tree before adding complex dashboards.
4. **Sub-items / dependencies**
   Model DB row parent-child and dependency links separately from row body child pages. This is required for project/gantt behavior comparable to Notion.
5. **Persisted chart views**
   Existing analysis is more powerful than a basic chart, but database-level saved chart views would make everyday use faster.

## Verification

- Changed TS/TSX files were transpile-parsed successfully with TypeScript.
- Full project typecheck cannot run from the provided ZIP because `node` and `electron` type definitions are absent (`node_modules` is not included).
