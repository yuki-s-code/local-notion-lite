# V752 React Flow Priority Upgrades

## Implemented

- Alignment snap guides for node edges and centers.
  - Shift temporarily disables smart guides.
  - Alt temporarily disables grid snapping.
- Collapsible frame/subflow nodes.
  - Child nodes and internal edges are hidden while collapsed.
  - Existing `parentFrameId` data is reused.
- Edge rendering modes: Bezier, smooth-step, and straight.
- Optional bidirectional arrows.
- Edge endpoint reassignment from the edge inspector.
- Edge labels use endpoint-aware midpoint calculation.
- Viewport virtualization with an overscan margin.
  - The minimap and persisted board retain all nodes.
  - The main canvas renders only nearby nodes and related edges.
- Zoom-level detail reduction for non-selected nodes.
- Connector handles extracted into a memoized component.
- Removed a duplicated `setSelectedIds` call.
- Added backward-compatible parsing for new node and edge fields.

## New/changed files

- `src/renderer/src/components/screens/freeformSnapping.ts`
- `src/renderer/src/components/screens/FreeformConnectorHandles.tsx`
- `src/renderer/src/components/screens/freeformCanvasModel.ts`
- `src/renderer/src/components/screens/FreeformLinkLayer.tsx`
- `src/renderer/src/components/screens/FreeformCanvasScreen.tsx`
- `src/renderer/src/styles/freeform-canvas.css`

## Validation

- TypeScript/TSX parser diagnostics: 0
- Duplicate top-level declarations in `src/renderer/src`: 0
- Duplicate static JSX class tokens: 0
- Stylesheet checks: passed for all 15 stylesheets

A complete Electron typecheck/build still requires installing the project's dependencies.
