# V264 Database Sidebar Tree

## Summary

This version turns the database section in the sidebar into a Notion-like lazy tree:

- Database nodes are expandable folders.
- Database rows are shown as page-like row nodes.
- Database row child pages are shown under each row.
- Database rows are loaded only when a database is expanded.
- Child pages are loaded only when a database row is expanded.
- The expanded/collapsed state is stored in localStorage.

## Added API

- `GET /databases/:id/sidebar-rows?limit=30&offset=0`
- `GET /databases/:id/rows/:rowId/sidebar-children`

## Added renderer component

- `src/renderer/src/components/screens/DatabaseSidebarTree.tsx`

## Behavior

- Clicking a database opens the database.
- Expanding a database loads up to 30 rows.
- Clicking a database row opens that row in the database preview drawer.
- Expanding a database row loads its child pages.
- Clicking a child page opens the normal page editor.
- Creating a child page from a row preview refreshes the sidebar tree.

## Non-goals

- Does not load all database rows into the sidebar at startup.
- Does not merge database rows into the normal page tree.
- Does not change GitHub Actions, package-lock, kuromoji, or node-nlp.
