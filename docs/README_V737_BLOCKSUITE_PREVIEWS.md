# v737 BlockSuite Whiteboard Previews

## Summary
Enhanced the Freeform / BlockSuite-style whiteboard so page, database, and PDF blocks show visual previews on the canvas instead of plain metadata cards.

## Changes

- Added page card previews using page title, icon, previewSnippet, status, and tags.
- Added database card previews using a compact table with the first 3 properties and first 3 rows.
- Added PDF attachment picker in the left panel.
- Added PDF canvas cards with embedded PDF preview via the existing attachment file route.
- Passed `attachments` and `apiUrl` from `main.tsx` to `FreeformCanvasScreen`.
- Added overflow-safe card styles so previews do not break the canvas layout.
- Kept implementation lightweight:
  - no new dependencies
  - no server API additions
  - existing attachment file URL route is reused
  - previews are built from already-loaded pages/databases/attachments

## Files changed

- `src/renderer/src/components/screens/FreeformCanvasScreen.tsx`
- `src/renderer/src/main.tsx`
- `src/renderer/src/styles/app.css`

## Validation

- `node scripts/check-styles.mjs` passed.
- `src/**/*.js` count is 0.
- Full typecheck/build still requires project dependencies.
