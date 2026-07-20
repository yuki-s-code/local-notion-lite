# V776 Workspace Dock Foundation

V776 keeps `WorkspaceWorkbench` as the sole owner of page/database tabs. The outer workspace only owns feature screens.

## Added

- Drag reorder for outer feature tabs
- Persistent workspace layout preferences
- Standard, Web, Research, Whiteboard and AI presets
- Comfortable/compact density
- Shared `workspaceActions` event API for future command palette and Spotlight
- Layout reset and an application-level recovery boundary
- No extra DockView package and no background mounting of BlockNote, React Flow or iframe screens

## Ownership boundary

- Page/database tab IDs, pinning, split and compare: `WorkspaceWorkbench`
- Feature screen order and active feature: workspace tabs
- Layout preset and density: workspace layout store

This version intentionally does not mount multiple heavy screens simultaneously. A later split-panel implementation can use the same registry/actions/storage without duplicating document-tab state.
