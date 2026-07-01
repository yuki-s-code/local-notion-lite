# V322 Database Row Semantic Text Fields

## Purpose

V321 expanded the Workspace Semantic SQLite cache to include FAQ, pages, journals, and database rows. V322 narrows the database-row embedding target so Ruri-v3 is used only where it is useful: prose-like database row content.

## What changed

- Database rows remain part of the Workspace Semantic Index.
- Embedding text now focuses on:
  - row title
  - text properties
  - URL properties
  - formula output when it is text-like
  - row detail markdown/body
- Structured properties are no longer embedded as main semantic body text:
  - number
  - date
  - checkbox
  - relation
  - rollup
- select / multi_select values are used as tags and metadata signals, not as main semantic text.
- Structured properties still remain available to normal SQLite filtering, sorting, calendar, board, relation, and rollup logic.

## Why

Ruri-v3 is useful for semantic matching of natural language, not for exact structured filtering. Embedding dates, numbers, checkbox values, relation ids, and rollup values can add noise and can make database-row recommendations less precise.

V322 keeps the architecture split:

- Normal SQLite: display, filters, sorts, dates, numbers, select, relation, rollup.
- FTS: keyword and exact-ish text search.
- Ruri-v3 SQLite: semantic search for page text, journal text, FAQ, and database row prose.

## Operational effect

After rebuilding the Workspace Semantic Index, database-row semantic results should be less noisy. Rows with meaningful titles, descriptions, notes, or row detail markdown should still appear. Rows that only contain dates, status, numbers, or relation values should not dominate semantic search.

