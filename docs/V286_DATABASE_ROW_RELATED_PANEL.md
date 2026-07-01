# v286 Database Row Related Panel

v286 connects the Workspace Semantic Related Panel to database row detail drawers.

## Goal

Database rows are often the practical unit of work: cases, tasks, contacts, procedures, schedules, and records. A user opening one row should immediately see nearby workspace knowledge without running a separate search.

## What changed

- `WorkspaceRelatedPanel` now supports a generic `target` prop in addition to the previous `pageId` prop.
- Supported targets:
  - `page`
  - `database_row`
  - `journal`
  - `faq`
- `DatabaseRowDetailDrawer` embeds the panel in a dedicated “関連” section.
- `DatabaseTable` passes page, database, row, and journal navigation callbacks into the drawer.
- Compact styling was added for drawer usage.

## UX policy

The related panel is deliberately presented as “related candidates,” not as an authoritative answer. This keeps it safe for operational use while still making discovery much faster.

Recommended trust order for future answer generation:

1. FAQ
2. Official PDF / attachment extract
3. Page body
4. Database row
5. Journal

## Maintenance policy

The related UI remains isolated in `WorkspaceRelatedPanel`. Database, page, journal, and Smart Assist screens should reuse this component instead of creating separate related-information implementations.
