# V345 Typecheck Fix

## Purpose
Fix TypeScript errors reported after v344.

## Fixes

- Added missing `DatabaseFilter` and `DatabaseSort` type imports in `vaultService.ts`.
- Fixed attachment index typing where `AttachmentInfo` does not declare `mimeType`.
  - Runtime data may still include `mimeType` from SQLite/derived index rows, so the access is intentionally treated as optional runtime metadata.
- Fixed a strict-null-check warning in `queryDatabaseRowsCore()` by reading `activeViewId` after the database-not-found guard.

## Notes

The local sandbox cannot complete `npm run typecheck` because this extracted ZIP does not include `node_modules`, so `electron` and `node` type definitions are missing in the sandbox. The user-reported six errors were all in `src/server/services/vaultService.ts` and have been addressed directly.
