# V759 Whiteboard Engine / Inline Editing / Knowledge Graph

## Architecture

The whiteboard is now exposed through explicit engine boundaries under:

`src/renderer/src/components/screens/whiteboard/engines/`

- `WhiteboardEngine.ts` — facade used by the screen
- `NodeEngine.ts` — node indexing and partitioning
- `EdgeEngine.ts` — edge routing and collapsed-frame projection boundary
- `LayoutEngine.ts` — automatic layout, alignment, distribution and snapping
- `RenderEngine.ts` — low-detail projection, viewport virtualization and render partitioning
- `SelectionEngine.ts` — selection and logical-group expansion
- `HistoryEngine.ts` — board state, persistence debounce and Undo/Redo
- `ClipboardEngine.ts` — copy, cut, paste and duplicate boundary
- `AIEngine.ts` — Knowledge Graph relation generation
- `SearchEngine.ts` — node search and jump boundary
- `PluginEngine.ts` — duplicate-safe plugin registry
- `PersistenceEngine.ts` — localStorage/IndexedDB assets and JSON import/export boundary

The former `useFreeformBoardState.ts` remains as a compatibility re-export only.

## Inline page editing

- Double-click a page node, or click `その場で編集`.
- The page title and Markdown body can be edited without leaving the canvas.
- Saving updates both Markdown and BlockNote blocks.
- The normal page view therefore receives the same updated content.
- Page metadata uses `baseUpdatedAt`, preserving the existing conflict check.
- The page preview cache and workspace page list are refreshed after save.

## Knowledge Graph

`Knowledge Graph` creates an editable graph from workspace pages.

Relationship scoring currently uses:

- shared tags
- shared status
- shared title terms
- shared preview/body terms

The strongest relationships are retained, degree is capped to reduce visual noise, and each edge records a short reason and confidence-like score. Generated nodes and edges are normal whiteboard objects and can be moved, grouped, edited, deleted and exported.

## Rich live previews

- Page preview capacity increased from 9 to 24 content lines.
- Database preview capacity increased from 5 to 10 rows.
- Page and database cards use internal scrolling when their content exceeds the node height.
- Inline editing expands the node through the persisted geometry so edge endpoints remain correct.

## Validation

- TypeScript/TSX syntax transpilation: passed for 17 edited files.
- Relative import resolution: passed.
- CSS structural check: passed for 15 stylesheets.
- Duplicate top-level declarations in `src/renderer/src`: 0.

A complete project typecheck still requires the project dependencies and Electron/Node type packages to be installed.
