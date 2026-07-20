# V746 Freeform maintainability refactor

## Purpose

Reduce the accumulated Freeform canvas override layers and separate reusable model logic from the React screen without changing the stored board format.

## Changes

- Extracted Freeform types, constants, board migration/validation, preview conversion, geometry helpers, and node factories to:
  - `src/renderer/src/components/screens/freeformCanvasModel.ts`
- Reduced `FreeformCanvasScreen.tsx` from roughly 2,880 lines to roughly 2,460 lines.
- Extracted all Freeform CSS from `styles/app.css` to:
  - `src/renderer/src/styles/freeform-canvas.css`
- Added the stylesheet to the central `app.css` import chain.
- Replaced the stacked `freeform-*-v733` through `freeform-*-v745` class names with stable, version-free class names.
- Removed repeated static class tokens created by the old compatibility layering.
- Removed six byte-identical duplicated CSS rules.
- Updated the main sidebar Freeform button to use the stable class name.
- Confirmed there are no duplicate top-level TypeScript declarations in `src/renderer/src`.
- Confirmed every Freeform class used by TSX has a corresponding CSS selector.

## Compatibility

The local storage keys remain unchanged:

- `local-notion:freeform-canvas-v735`
- `local-notion:freeform-canvas-v733`

Existing saved boards therefore continue to load and migrate as before.

## Validation

- TypeScript/TSX syntax transpilation succeeded for:
  - `FreeformCanvasScreen.tsx`
  - `freeformCanvasModel.ts`
  - `main.tsx`
- `npm run check:styles` succeeded for all 15 stylesheets.
- Full project type checking still requires installed Electron and Node type definitions.
