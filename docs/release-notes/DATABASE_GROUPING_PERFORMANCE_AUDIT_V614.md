# Database grouping performance audit v614

## Added
- Table view grouping using the existing `groupByPropertyId` saved per view.
- Group expansion/collapse is per-device localStorage (`fast-db-groups-collapsed:<databaseId>`), so it never updates shared DB data, history, semantic index, link index, or task index.
- Group labels and counts are generated from the already filtered/sorted client-visible rows.

## Performance safeguards
- The table keeps the existing virtual scrolling model. Group headers are virtual list entries, so only the viewport plus overscan is mounted.
- Grouping is intentionally disabled in server-table mode. A server page is not a complete filtered result, so page-local grouping would be incorrect and forcing a full renderer load would be inefficient.
- Grouping is also disabled where sub-item hierarchy is active, avoiding ambiguous nesting and preserving one-row-one-position hierarchy semantics.
- No aggregate-per-group calculation was added: that would multiply scans by group count. The header shows an O(1) stored group count.

## Next safe enhancement
- Add server-side grouped queries only after a query contract can return group counts and page-aware rows without emitting the complete result set to the renderer.
