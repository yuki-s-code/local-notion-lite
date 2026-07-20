# v676: Query / AI service extraction

- Moved FTS page search into `services/search/workspacePageSearchService.ts`.
- Moved backlink and broken-link read queries into `services/links/workspaceLinkQueryService.ts`.
- Moved BlockNote editor-only AI transformation into `services/ai/editorAiEditService.ts`.
- `VaultService` remains the compatibility facade for routes and callers. Its write/sync/semantic orchestration is deliberately unchanged.
- Extracted services receive narrow callbacks instead of `VaultService`, preventing direct access to unrelated shared-folder, semantic, or write paths.
