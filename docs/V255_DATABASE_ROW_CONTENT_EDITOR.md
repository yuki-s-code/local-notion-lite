# V255 Database Row Content Editor

## Summary

This version adds a Notion-like editor body to each database row preview. A row can now have structured editor content below its properties, while the database table itself remains lightweight.

## Storage design

Row body content is stored outside the database JSON file.

- Shared databases: `database-row-pages/<databaseId>/<rowId>.json`
- Private databases: `privateDatabases/.row-pages/<databaseId>/<rowId>.json`

This keeps large editor bodies from bloating `databases/<databaseId>.json` and reduces the risk of full-database overwrite conflicts.

## Added server files

- `src/server/services/database/databaseRowContentService.ts`

Responsibilities:

- get row editor content
- save row editor content
- create row editor content defaults
- optimistic conflict detection by `baseUpdatedAt`
- write conflict snapshots under `conflicts/`

## Added API

- `GET /databases/:databaseId/rows/:rowId/content`
- `PUT /databases/:databaseId/rows/:rowId/content`

The save API accepts:

- `title`
- `markdown`
- `blocksuite`
- `baseUpdatedAt`
- `scope`

## Added renderer files

- `src/renderer/src/components/database/DatabaseRowContentEditor.tsx`

The component is rendered inside `DatabaseRowDetailDrawer` below the property section and Relation backlink section.

## Conflict behavior

If a row body was updated elsewhere after it was loaded, saving is rejected with:

- `code: DATABASE_ROW_CONTENT_CONFLICT`
- `conflictType: database-row-content`

The incoming and current versions are saved to a conflict folder.

## Non-goals

This version does not yet index row body content into SQLite FTS. That should be a later step if row body full-text search is needed.
