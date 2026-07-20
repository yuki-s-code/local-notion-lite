# V677 CSS modularization

## Goal
Move the recent feature-specific tail of `legacy-core.css` into feature-owned files without changing the cascade order.

## Extracted styles
- `home-dashboard.css` — Work Home dashboard styling (v562)
- `journal.css` — Journal conflict and attachment UI (v565–v567)
- `inbox-ocr.css` — Centralized OCR center and source handoff UI (v568–v571)
- `database.css` — Database bulk-edit and relation preview UI (v572–v573)
- `analysis.css` — Analysis notebook UI (v574–v599)
- `database-performance.css` — Database table, hierarchy and task affordances (v602–v619)
- `workspace.css` — Workspace sync and reopen-history UI (v636)
- `knowledge-map.css` — Knowledge-map UI (v638–v655)

`app.css` is now the only stylesheet entrypoint and imports files in the original chronological cascade order. `legacy-core.css` retains older cross-cutting rules and is smaller by the extracted blocks.

## Safety
No selector names were renamed and no declaration values were changed. The extraction preserves each moved block's order relative to the other moved blocks.
