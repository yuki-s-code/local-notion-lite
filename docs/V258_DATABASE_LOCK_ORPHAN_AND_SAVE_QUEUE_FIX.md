# V258 Database Lock Orphan and Save Queue Fix

## Summary

This version fixes a false database lock/conflict scenario that can happen after stopping the development server with Ctrl+C and restarting the app.

## Fixed

### 1. Reclaim orphaned database locks from the same computer/user

When the app is stopped with Ctrl+C, the normal database lock release handler cannot run. The lock file can remain in `locks/database_<id>.lock` with a future `expiresAt`, so the next app instance may think the database is locked by another window.

`DatabaseLockService` now safely reclaims a lock when it belongs to the same OS user on the same computer. Locks from other users or computers are still respected.

### 2. Serialize database autosaves

Rapid DatabaseTable updates can send multiple PUT requests with stale `baseUpdatedAt` values. The first request updates the database timestamp, and the second request can then be misclassified as a conflict.

Database autosaves are now serialized:

- only one save request is in flight at a time
- while saving, the latest pending database snapshot is queued
- after save completes, the queued snapshot is saved with the latest returned `updatedAt`

## Not changed

- package-lock.json
- GitHub Actions
- kuromoji
- node-nlp
- database schema
