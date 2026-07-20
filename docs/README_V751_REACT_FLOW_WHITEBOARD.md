# V751 React Flow-style whiteboard

## Main changes
- Persistent source/target connector handles (`fromHandle` / `toHandle`)
- Drag-to-connect snaps to the nearest side of the target node
- Edge paths preserve their selected handles after nodes move
- Connection-aware hierarchical layout: left-to-right and top-to-bottom
- Grid layout fallback
- Multi-selection alignment: left, horizontal center, right, top, vertical center, bottom
- Multi-selection distribution: horizontal and vertical
- React Flow-style Ctrl/Cmd + wheel zoom centered on the pointer
- Cmd/Ctrl+A selects all non-drawing nodes
- Cmd/Ctrl+0 fits the graph
- Arrow-key node nudging; Shift+Arrow uses a larger step
- Layout calculations extracted to `freeformLayout.ts`
- CSS controls consolidated into the existing version-free freeform stylesheet

## Compatibility
Existing boards remain readable. Old edges without handle data continue using automatic anchor selection.

## Validation
- TypeScript/TSX transpile syntax validation passed for all edited files.
- Style checker passed for all 15 stylesheet files.
- Full typecheck could not run because the supplied archive does not contain the Electron and Node type definitions.
