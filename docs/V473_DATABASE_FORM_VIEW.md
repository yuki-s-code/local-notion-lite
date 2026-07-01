# V473 Database Form View

## Purpose
Adds a form-type database view focused on fast, low-error data entry without creating a second database or a parallel persistence path.

## Design
- `DatabaseView.type` now supports `form`.
- Form entries call the same in-memory row creation path as standard new-row creation.
- Existing table, board, calendar, gallery, timeline, gantt, CSV, analysis, relation and history flows continue to use the same database rows.
- Formula, rollup and relation fields are not editable in the entry form. They are configured after creation from row detail, preventing accidental mutation of computed or linked data.

## UI
- Form is available from the database view switcher and View settings.
- Entry layout uses a focused card with a compact progress indicator and a recent-records sidebar.
- Responsive layout collapses to one column on narrow screens.
