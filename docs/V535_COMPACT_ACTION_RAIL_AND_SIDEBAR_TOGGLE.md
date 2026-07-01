# v535 — Compact Action Rail and Single Sidebar Toggle

## Fixed
- Constrained the sticky command/action row to the workspace width.
- Command actions scroll within the row instead of causing horizontal page overflow.
- Applied the same containment to database header actions.
- Removed duplicate in-page sidebar-open buttons. The sidebar has one global control:
  - Sidebar open: hide control in the sidebar header.
  - Sidebar closed: single fixed restore control at the top-left.

## UX
- Tabs remain the top workspace rail.
- The active page/DB command row stays below it and does not widen the editor.
