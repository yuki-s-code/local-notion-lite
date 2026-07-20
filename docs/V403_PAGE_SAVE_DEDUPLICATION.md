# v403 Page Save Deduplication

## Purpose

Prevent normal page editing from repeatedly saving identical BlockNote content and creating duplicate page-history snapshots.

## Client-side guard

`src/renderer/src/main.tsx` now builds a canonical page signature from:

- title
- icon
- normalized page properties
- scope
- BlockNote blocks

The page editor compares every `onChange` result with the most recently persisted signature. If unchanged, it does not mark the page dirty and does not schedule another save.

The page save queue also compares queued snapshots with the persisted signature. This protects against a BlockNote change event that arrives while an earlier identical save is still finishing.

## Server-side guard

`VaultService.savePage()` compares a requested bundle with the persisted page before calling `backupPage()`. If title, icon, normalized properties, scope, markdown, and BlockNote data are unchanged, it returns the current bundle without:

- rewriting page files
- changing `updatedAt`
- updating SQLite indexes
- creating a backup/history entry

## Scope

This change is limited to normal page saves. It does not change database, database-row body, journal, lock, shared-folder, or cache behavior.
