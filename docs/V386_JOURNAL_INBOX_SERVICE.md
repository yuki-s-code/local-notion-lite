# v386 Journal / Inbox Service split

`JournalService` and `InboxService` now own their persistence rules instead of keeping implementation details in `VaultService`.

## Guarantees

- Inbox mutations re-read the latest JSON inside the shared write lease.
- Journal saves compare `baseUpdatedAt` with the current persisted revision and return `JOURNAL_CONFLICT` rather than silently overwriting newer content.
- Task-index and workspace-summary updates remain callbacks from `VaultService`, keeping indexes consistent without coupling storage services to SQLite.
- Existing renderer/API method names remain unchanged.

## Tests

`tests/inboxJournalService.test.ts` covers serial Inbox writes, stale Journal revision rejection, and draft Journal reads that do not create files.
