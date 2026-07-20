# V766 Google Workspace UX / Architecture Refactor

## UX
- Consolidated Drive, Calendar, Gmail, Docs/Sheets export, and auth settings under one Google Workspace hub.
- Replaced four whiteboard sidebar modes with a single `Google` mode.
- Moved Drive content synchronization into the Drive tab.
- Added a shared account/status header, permission badges, and last Drive sync timestamp.

## Security and permissions
- Added capability-based incremental OAuth scopes.
- Drive initially requests Drive read-only access only.
- Calendar, Gmail, and Docs/Sheets scopes are requested only when each feature is used.
- Full reauthorization remains available from Workspace settings.

## Persistence and sync
- Moved Drive change-token ownership from renderer localStorage to Electron main process.
- Added `syncDriveChanges()` to initialize, page, persist, and recover Drive change tokens.
- Clears Drive sync state on disconnect, OAuth client change, or account switch.
- Preserves unrelated Google Workspace config fields when saving the OAuth client ID.

## Maintainability
- Added `GoogleWorkspacePanel.tsx` as the single renderer entry point.
- Consolidated four Google plugins into `integration.google-workspace`.
- Existing Drive, Calendar, Gmail, and export components remain focused feature panels.
- Existing Google node kinds and saved whiteboard data remain compatible.

## Validation
- TypeScript/TSX syntax parse: passed for all modified files.
- CSS structural checks: 15 stylesheets passed.
