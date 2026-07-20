# V253 Screen and Database Service Split

## Scope

This revision continues the post-V252 cleanup. It keeps the existing API names and user-facing behavior intact while creating clearer seams for the next refactor.

## Changes

### 1. Smart Assist screen split

Moved the Smart Assist UI and related local helper logic out of `src/renderer/src/main.tsx` into:

- `src/renderer/src/components/screens/SmartAssistScreen.tsx`

Exports:

- `LocalSmartAssistView`
- `HomeDashboard`

This removes the largest renderer-side Smart Assist block from `main.tsx`.

### 2. Settings screen split

Moved settings modal UI into:

- `src/renderer/src/components/screens/SettingsModal.tsx`

`main.tsx` now imports `SettingsModal` instead of owning the settings screen implementation directly.

### 3. Page tree / page workspace split

Moved page outline and page tree item UI into:

- `src/renderer/src/components/screens/PageOutlinePanel.tsx`
- `src/renderer/src/components/screens/PageTreeItem.tsx`

This starts the page-tree/page-editor extraction without changing the existing sidebar behavior.

### 4. Database service facade

Added:

- `src/server/services/database/databaseWorkspaceService.ts`

`VaultService` now routes public database methods through `DatabaseWorkspaceService`. The existing implementation bodies were retained as `*Core` methods to avoid a high-risk move in one step. This creates a stable migration seam for moving individual database methods out of `VaultService` in future revisions.

Public database methods preserved:

- `listDatabases`
- `getDatabase`
- `createDatabase`
- `saveDatabase`
- `queryDatabaseRows`
- `getDatabasePerformance`
- `rebuildDatabaseIndex`
- trash/restore/delete helpers
- row/property helpers

## Non-goals

Not changed in this revision:

- `package-lock.json`
- GitHub Actions / `npm ci`
- kuromoji
- database schema
- API route names

## Notes

- `kuromoji` remains unused.
- `nodeNlpFaqEngine.ts` remains deleted from V252.
- `main.tsx` is now much smaller, but still contains shared app orchestration and several legacy helper blocks.
- `VaultService` still contains the database core implementation. The new `DatabaseWorkspaceService` makes it safe to move those core methods incrementally later.
