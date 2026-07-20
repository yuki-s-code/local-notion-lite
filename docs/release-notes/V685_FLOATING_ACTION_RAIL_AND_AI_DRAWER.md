# V685 — Floating action rail and AI drawer extraction

## Fixed action layout

The page-local bookshelf action and workspace AI launcher now render inside one fixed action rail.
The rail owns viewport coordinates; controls only own their visual styling. This prevents two fixed
buttons from occupying the same lower-right coordinates.

- AI launcher remains the bottom action.
- The current-page bookshelf action appears above it only while a page is open.
- Mobile uses the same stack with compact labels and safe-area offsets.

## UI extraction

`main.tsx` no longer renders the floating action markup or AI drawer internals directly.

- `components/workspace/FloatingWorkspaceActions.tsx`
- `components/workspace/WorkspaceAiDrawer.tsx`

The drawer preserves the existing close-before-navigation behavior and existing Chat/Search API.
