# V750 Freeform ink-only drawing and drag connect

## Changes
- Drawing nodes no longer show a card background, border, selection outline, hover lift, or resize handle.
- Connector handles appear on the four sides of cards when hovered, selected, or while the connector tool is active.
- Dragging a connector handle shows a live dashed preview line.
- Releasing over another card snaps and creates the connection.
- The target card is highlighted while dragging.
- Existing click-to-connect behavior remains available for compatibility.

## Validation
- FreeformCanvasScreen.tsx parsed successfully with esbuild.
- Stylesheet structural checks passed.
