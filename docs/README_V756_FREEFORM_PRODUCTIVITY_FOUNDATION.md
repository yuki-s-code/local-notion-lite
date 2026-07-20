# V756 Freeform Productivity Foundation

## Added
- Node finder (`Cmd/Ctrl + K`) with title/body/type search and animated viewport jump.
- Graph-aware copy, cut and paste (`Cmd/Ctrl + C/X/V`).
- Clipboard payload preserves internal edges, logical groups and selected frame parent relations.
- Duplicate now reuses the same clipboard cloning engine instead of maintaining separate clone logic.
- System clipboard integration with in-memory fallback when browser clipboard permission is unavailable.
- JSON board export/import with structural validation and invalid-edge filtering.
- Header controls for search, export, import, copy and paste.

## Maintainability
- Added `freeformClipboard.ts` for graph cloning and clipboard serialization.
- Added `freeformSearch.ts` for board search.
- Added `freeformBoardTransfer.ts` for portable import/export.
- No duplicate top-level declarations detected in `src/renderer/src`.
- No duplicate static JSX class tokens detected.

## Validation
- TypeScript/TSX transpile diagnostics: passed for all edited files.
- CSS brace validation: passed.
