# V681 UI state and style guard

## Scope

- Extract the page-tree context menu from `main.tsx` into `components/menus/PageContextMenu.tsx`.
- Move context-menu state, viewport positioning, and open/close handling to `hooks/usePageContextMenu.ts`.
- Add `npm run check:styles` and run it before every production build.

## Style guard checks

The check verifies the stylesheet set under `src/renderer/src/styles` for:

1. Unterminated or stray CSS comments.
2. Unbalanced braces.
3. Missing relative `@import` targets.
4. Stylesheets not imported from the single `app.css` entrypoint.

Empty placeholder files for Smart Assist and tag management were removed. New feature styles must be added to a real feature stylesheet and imported from `app.css`.

## Compatibility

The page context menu still calls the same workspace callbacks for opening, creating, duplicating, favoriting, moving, trashing, and bookshelf insertion. No page, database, journal, or shared-folder data contract changed.
