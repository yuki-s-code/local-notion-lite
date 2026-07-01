# V552: Database automatic timestamps

## Added property types

- `created_time` — renders each row's immutable `createdAt` timestamp.
- `last_edited_time` — renders each row's `updatedAt` timestamp.

Both are read-only, do not store duplicate values in `row.cells`, and are immediately available for existing rows.

## Supported surfaces

- Table view and row detail drawer
- Calendar, Timeline, Gantt, Gallery, and Board previews
- Filters, sorts, CSV export, and formula lookup
- Date-property selection for calendar/timeline/gantt views

## Deliberately not added

- A second attachment property. Database-row attachments are already supported through the row body editor and use the existing attachment service. Adding a parallel property would duplicate storage, retrieval, indexing, and access-control paths.
- A separate status type. Existing `Select` provides the same semantics without creating a competing model.
