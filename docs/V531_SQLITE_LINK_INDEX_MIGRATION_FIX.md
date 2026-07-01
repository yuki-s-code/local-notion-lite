# v531 — SQLite link-index migration order fix

## Fixed startup failure

Existing local databases created before v529 can have `workspace_link_index` without:

- `target_type`
- `target_database_id`
- `target_row_id`

The initial schema block attempted to create an index using `target_type` before the
compatibility migration added those columns, causing startup to fail with:

`SqliteError: no such column: target_type`

## Migration behavior

The compatibility index is now created only after all missing columns have been
added with `ALTER TABLE`. No local database deletion is required. A failed prior
startup is safe: on the next launch, the migration completes in the correct order.
