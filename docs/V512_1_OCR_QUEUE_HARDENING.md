# V512.1 OCR Queue Hardening

## Changes

- Added atomic cross-PC job claiming using a persisted worker/lease record.
- Added heartbeat and 90-second lease expiry for running jobs.
- Stale running jobs are marked failed and require explicit retry; they are not auto-restarted.
- Cancellation is checked during external OCR commands and between PDF pages.
- Added persisted PDF progress (`totalPages`, `processedPages`, `currentPage`) and UI display.
- Made enqueue/cancel state decisions atomic under the shared JSON mutation lock.
- Routed the legacy direct OCR endpoint through the durable queue.
- Added regression tests for atomic claim and stale lease recovery.

## Validation performed

- TypeScript syntax transpilation passed for every modified TypeScript/TSX file using TypeScript 5.8.3.
- Full `npm test`, `npm run typecheck`, and production build were not runnable in this archive because `node_modules` and a dependency lockfile are not included. An attempted dependency installation did not complete in the available environment.
