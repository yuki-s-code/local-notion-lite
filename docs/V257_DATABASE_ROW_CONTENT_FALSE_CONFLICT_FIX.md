# V257 Database Row Content False Conflict Fix

## Summary

Fixes a false conflict in the database row content editor where a single user could see:

- `本文の競合を検出しました。別端末または別ウィンドウで更新されています。`
- `PUT /databases/:databaseId/rows/:rowId/content 400 Bad Request`

This was caused by two row-content autosave edge cases introduced in V255/V256.

## Fixes

### 1. First-save false conflict

`getRowContent()` returns a synthetic empty document when the row content file does not exist yet. That synthetic document receives a new `updatedAt` timestamp on every call.

Before V257, `saveRowContent()` called `getRowContent()` again and compared the new synthetic `updatedAt` with the renderer's original `baseUpdatedAt`. Because the file did not exist yet, the timestamps differed and the first real save was incorrectly treated as a conflict.

V257 now checks whether the row content file actually exists before applying conflict detection.

Conflict detection is now applied only to persisted row-content files.

### 2. Overlapping autosave false conflict

BlockNote may emit multiple changes while the editor initializes or while a previous autosave request is still in flight.

Before V257, a second autosave could use an old `baseUpdatedAt` while the first autosave had already updated the file on disk. That made the second request look like a real conflict.

V257 serializes row-content autosaves in `DatabaseRowContentEditor.tsx`:

- If a save is already in progress, the latest pending blocks are stored.
- After the current save completes, the pending blocks are saved using the newly returned `updatedAt`.
- Identical content is still skipped.

## Files changed

- `src/server/services/database/databaseRowContentService.ts`
- `src/renderer/src/components/database/DatabaseRowContentEditor.tsx`

## Not changed

- package-lock.json
- GitHub Actions
- kuromoji
- node-nlp
- database schema
