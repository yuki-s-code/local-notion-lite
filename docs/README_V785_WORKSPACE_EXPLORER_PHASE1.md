# V785 Workspace Explorer Phase 1

## Added

- Shared `WorkspaceExplorerItem` model
- Read-only `Workspace Explorer Service`
- Cross-search for pages, databases and workspace screens
- Favorites shared inside Explorer
- Recent items shared inside Explorer
- Workspace Explorer screen
- Sidebar quick-open button
- Responsive single-column result list

## Architecture

Explorer does not duplicate page or database data. It builds a normalized read model from the existing page state, database state and workspace screen registry. Only favorite keys and recent keys are persisted as lightweight local UI state.

## Compatibility

No database migration is required. Existing workspace persistence, autosave, synchronization and page/database navigation remain unchanged.
