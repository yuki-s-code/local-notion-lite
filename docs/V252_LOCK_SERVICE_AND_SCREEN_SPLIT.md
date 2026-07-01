# V252 DB Lock Renewal / Service Split / Screen Split

## Scope

- Added automatic database lock renewal while a database is open and editable.
- Split database lock handling out of `vaultService.ts`.
- Split database conflict snapshot writing out of `vaultService.ts`.
- Removed the unused legacy `nodeNlpFaqEngine.ts` file.
- Split Inbox / Quick Capture UI out of `main.tsx`.

## Database lock renewal

New API:

- `POST /databases/:id/lock/renew`

Renderer behavior:

- When a database is open and editable, the renderer renews the lock every 60 seconds.
- If renewal fails, the database switches to read-only mode and shows a status message.

## Server service split

New files:

- `src/server/services/database/databaseLockService.ts`
- `src/server/services/database/databaseConflictService.ts`

`VaultService` now delegates database lock and database conflict snapshot responsibilities to these services.

## Renderer split

New files:

- `src/renderer/src/components/screens/InboxScreen.tsx`
- `src/renderer/src/hooks/useDatabaseLockRenewal.ts`

`main.tsx` still remains large, but Inbox and lock-renewal concerns are now separated.

## Not changed

- `package-lock.json`
- GitHub Actions npm ci migration
- kuromoji; it remains unused
