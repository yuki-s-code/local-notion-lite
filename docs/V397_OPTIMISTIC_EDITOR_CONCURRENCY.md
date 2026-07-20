# v397 Optimistic editor concurrency

## Why this changed

Persistent `.lock` files were created when opening pages/databases. On the target Windows/SMB shared-folder environment, a newly created lease could be observed inconsistently by the same application, causing every resource—including brand-new data—to open read-only.

## New behavior

- Opening a page or database never creates or acquires a long-lived editor lock.
- Pages and databases open editable.
- Saving still compares `baseUpdatedAt` against the persisted shared resource.
- A stale editor saves a conflict snapshot and stops rather than silently overwriting another editor's update.
- Existing lock endpoints remain only for backward-compatible API use. The renderer no longer depends on them for normal editing.

## Operational consequence

This is optimistic concurrency, not real-time locking. Two users may type at the same time; the second save is asked to reload and receives a conflict copy if the shared version changed.
