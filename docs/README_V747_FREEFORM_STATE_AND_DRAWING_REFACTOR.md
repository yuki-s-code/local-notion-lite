# V747 Freeform state and drawing refactor

## Main changes

- Extracted board persistence, history, undo/redo, transient updates, and debounced node edits from `FreeformCanvasScreen.tsx` into `useFreeformBoardState.ts`.
- Fixed no-op board updates incorrectly creating history entries.
- Centralized board ref synchronization so pointer operations and asynchronous asset migration read the latest board.
- Flushes pending text/crop edits before normal commands, undo, and redo.
- Added `buildSmoothPath()` as a shared geometry helper.
- Changed stored drawing preview and live drawing preview from raw line segments/polyline to a quadratic smoothed SVG path.
- Added the missing `FreeformLink` type import used by template generation.
- Reduced `FreeformCanvasScreen.tsx` from 2,458 lines to 2,355 lines.

## Repository checks

- Scanned TypeScript/TSX files for repeated top-level named function and class declarations. No same-file function/class overwrite was detected.
- Reviewed duplicate CSS selector reports. Many are intentional media-query or later compatibility overrides in legacy styles, so they were not removed automatically.
- Kept the freeform stylesheet on the stable, non-versioned class system introduced in V746.

## Validation

- TypeScript syntax transpilation passed for:
  - `FreeformCanvasScreen.tsx`
  - `useFreeformBoardState.ts`
  - `freeformCanvasModel.ts`
- Style checker passed for all 15 stylesheets.
- Full project typecheck still requires installed project dependencies and type packages.
