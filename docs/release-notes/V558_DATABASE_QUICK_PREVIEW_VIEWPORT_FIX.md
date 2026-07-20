# V558: Database quick-preview viewport fix

## Fixed
- Sidebar database and row previews now clamp their vertical anchor using the card's maximum viewport height.
- A preview opened near the bottom of the screen remains fully inside the viewport.
- Long preview contents scroll inside the card instead of being silently clipped.

## Scope
- UI-only change. No shared-folder, database, page, or workspace-tab data changes.
