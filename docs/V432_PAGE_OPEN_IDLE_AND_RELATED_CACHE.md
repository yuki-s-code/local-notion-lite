# V432: Page Open Idle Coordination and Related Cache

## Purpose
Further reduce first-page contention on shared-folder workspaces and avoid repeated related-page work.

## Changes
- Initial shared-folder import waits 2.2 seconds and then uses an idle slice when supported.
- The initial cached local list still renders immediately.
- Related-page results use a 10-minute, 48-entry process-local LRU cache.
- Manual refresh bypasses the cache; rebuilding the semantic index clears it.
- Related lookup is scheduled with `requestIdleCallback` when available after the existing render delay.
- Renderer DevTools logs `[page-open]` with fetch and first-paint timing.

## Safety
No page body, tag, history, or shared data format is changed. Shared import remains automatic; only its startup scheduling changes.
