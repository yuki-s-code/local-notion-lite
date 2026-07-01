# V392: Save and Navigation Coordinators

## Purpose

This change separates two cross-screen concerns that had grown inside
`src/renderer/src/main.tsx`:

- primary-screen navigation sequencing;
- read-only link-preview sequencing;
- common queued-save flushing behaviour.

## NavigationCoordinator

`NavigationCoordinator` keeps independent monotonically increasing request
sequences for primary navigation and link previews. Slow link-preview loading
can no longer invalidate a page, Journal, or database request. Conversely,
starting primary navigation invalidates stale primary requests without relying
on preview state.

## Save coordinator helper

`flushQueuedSave()` centralizes the existing "request the newest snapshot, then
wait for the active drain" protocol. Page and Journal flushes use it when
switching screens or responding to the shutdown save request.

The feature-specific queues remain in their existing owners. This is deliberate:
it reduces refactor risk while establishing a small, testable seam for future
SaveCoordinator extraction.
