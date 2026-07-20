# V254 Service and Screen Split Continued

## Scope

This version continues the refactor from V253 without changing package-lock, GitHub Actions, kuromoji, route names, or renderer API contracts.

## Changes

### Renderer screen split

Moved additional workspace UI out of `src/renderer/src/main.tsx`:

- `CommandPalette` -> `src/renderer/src/components/screens/CommandPalette.tsx`
- `AttachmentManagerView`, `NotificationCenterView`, `LinkManagerView`, `TrashCenterView`, `WorkspaceAdminView`, `BackupCenterView` -> `src/renderer/src/components/screens/WorkspaceUtilityScreens.tsx`
- `HomeDashboard` -> `src/renderer/src/components/screens/HomeDashboard.tsx`

`main.tsx` now imports these screens and keeps orchestration/state wiring.

### Smart Assist screen split

`HomeDashboard` was removed from `SmartAssistScreen.tsx`, reducing that file and keeping the Smart Assist screen focused on Smart Assist chat/admin behavior.

### Database service split

The database domain service was split into sub-services:

- `databaseCrudService.ts`
- `databaseIndexQueryService.ts`
- `databaseWorkspaceService.ts`

`DatabaseWorkspaceService` now delegates CRUD and index/query responsibilities to smaller service boundaries. The legacy `VaultService` core implementations remain as the execution source for compatibility, so methods can be moved out safely one by one later.

### Removed legacy NLP

The project still has no `kuromoji` references and no `nodeNlpFaqEngine` references/files.

## Notes

The environment used for this edit does not have node_modules installed, so full TypeScript validation cannot complete. The observed blocker is missing `node` and `electron` type definitions, which is unrelated to these refactors.
