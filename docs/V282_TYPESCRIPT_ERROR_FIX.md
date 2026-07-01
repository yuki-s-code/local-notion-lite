# V282 TypeScript error fix

## Summary
Fixed TypeScript errors reported after V281 without changing runtime behavior or UI layout.

## Fixes
- Restored compatibility between `PageTreeItem` template types and `main.tsx` templates.
- Extended `PageProperties` with optional `url` and `summary` fields used by the page tree preview normalizer.
- Fixed Smart Assist screen type issues after screen split:
  - domain profile optional domain access
  - `sourceDocs` typo
  - typed FAQ selection callbacks
  - typed tag rendering callbacks
- Normalized server route inputs where zod schemas allow `null` but service methods expect `undefined`.
- Narrowed Inbox source to `quick | manual`.
- Cast database save/property route payloads at the API boundary after validation.
- Fixed Smart Assist store type guards.
- Fixed transformer semantic generic cast using `unknown` intermediary.
- Fixed several implicit `any` callbacks in `vaultService.ts`.
- Made `SmartAssistTransformerSettings` compatible with the store-level settings shape.
- Added null guard around page lookup during DB-row link scanning.

## Not changed
- package-lock.json
- GitHub Actions
- UI behavior
- kuromoji / node-nlp
