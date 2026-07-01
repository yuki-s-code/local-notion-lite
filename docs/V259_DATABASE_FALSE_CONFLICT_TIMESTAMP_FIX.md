# V259 Database false conflict timestamp fix

## Problem
After V258, a database could show a conflict even when no other terminal or window was using it.
The displayed values could be inverted, for example:

- currentUpdatedAt: older persisted database timestamp
- baseUpdatedAt: newer editing baseline timestamp

That pattern indicates an optimistic client timestamp was used as the conflict base.

## Fix
- Renderer now resolves `baseUpdatedAt` from the last persisted baseline when an optimistic snapshot exists.
- Manual save and scope changes use the same baseline resolver.
- Server-side conflict detection now treats a mismatch as a true conflict only when the persisted database is newer than the submitted base timestamp.
- If the submitted base timestamp is newer than the persisted timestamp, it is treated as an optimistic local timestamp and the save is allowed.

## Files
- `src/renderer/src/main.tsx`
- `src/server/services/vaultService.ts`
