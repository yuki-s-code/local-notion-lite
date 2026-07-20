# Database interaction audit v610

## Delivered
- Per-device column reordering using drag handles in the table header.
- Header menu action to move a column to the beginning.
- Column order is stored only in localStorage (`fast-db-order:<databaseId>`). It does not write the shared database document and therefore does not trigger shared-folder synchronization, database index rebuilds, semantic index updates, or history entries.
- Reset layout now restores default visibility, widths, and order together.

## Performance guardrails
- Reordering only changes a short property-id array and rerenders headers/current virtual rows.
- Server Table paging remains server-side; no additional row retrieval is performed.
- Local order IDs are normalized before persistence, so removed properties do not accumulate stale state.

## Recommended next step
Keyboard cell navigation and grid paste should be implemented with an event-delegated table-level focus controller, not per-cell global listeners, to keep thousands of virtualized rows lightweight.
