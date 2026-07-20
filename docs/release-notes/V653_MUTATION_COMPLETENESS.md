# v653 Mutation completeness

- Prevents shared-imported trashed pages from recreating active derived indexes.
- Emits normalized mutations for database row, database, Journal, AI-page and shared-import changes.
- Makes local knowledge-map refresh target-aware, while global maps remain complete.
- Batches local-graph DB row metadata lookup to remove the edge-driven N+1 query.
- Adds graph/cache mutation events after DB-row content saves.

Known deliberate boundary: remote hard deletes still require a shared tombstone/manifest to distinguish deletion from an SMB visibility failure.

- Emits attachment cache mutations for page and Journal attachment additions.
- Adds databaseRowIds to the normalized mutation contract so consumers can be exact when needed.
