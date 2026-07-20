# V680 Workspace Mutation Coordinator

## Purpose

Renderer-side writes now publish workspace-cache invalidation identities and targeted semantic-refresh requests through `WorkspaceMutationCoordinator`. This removes repeated CustomEvent assembly from page, database-row, AI-search, and database-sidebar write surfaces.

## Behavior preserved

- Dispatch remains synchronous because DockView page-removal fallback selection relies on same-turn mutation delivery.
- Existing `local-notion:workspace-graph-mutated`, `local-notion:workspace-data-mutated`, and `local-notion:semantic-refresh-request` event names remain unchanged.
- Semantic updates are still asynchronous in `main.tsx`; the coordinator only normalizes target dispatch.

## Cleanup

- Deleted `emitWorkspaceMutation.ts`; all renderer writers now use the coordinator.
- Deduplicates semantic targets inside a single publish call.
