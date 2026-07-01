# V372 Conflict and Save Stability Pack

## Purpose
Reduce self-conflicts and unsaved edits when a single user edits a shared-folder workspace.

## Changes
- Electron single-instance lock: a second launch focuses the already-open app instead of starting another writer.
- Database locks no longer reclaim an unexpired lock merely because it belongs to the same Windows user and computer.
- Database save queues use the last server-confirmed `updatedAt` as `baseUpdatedAt` for the next queued save.
- Main page and side-peek page saves are serialized. A later edit replaces the queued snapshot and is saved after the active request finishes.
- Main page edits flush before changing pages or releasing the edit lock.
- Page locks now renew every 60 seconds while editing.
- `listConflicts()` recognizes page, database, and database-row conflict metadata so the UI can report all saved conflict snapshots.

## Operational expectation
A stale lock after a crash remains protected until the five-minute TTL expires. This is intentional: it is safer than allowing a second active app instance to overwrite the first one. Close the other app, wait for expiry, or remove only a clearly stale lock through the lock management UI.
