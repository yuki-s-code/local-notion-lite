# V380 Shared Data Consistency

V380 applies a short-lived exclusive write lease to small shared JSON resources without changing existing JSON file formats.

## Covered

- Inbox (`inbox/items.json`)
- Individual Journal entries (`journals/<date>/journal.json`)
- Smart Assist JSON writes managed by `SmartAssistStore`, including synonyms, rule profiles, settings, improvement queue, evaluation data, reports, and chat logs.

## Behaviour

1. Mutations in one app instance are queued per file.
2. The writer creates an adjacent `.mutation.lock` using exclusive create semantics.
3. A second writer waits briefly and then receives `423 SHARED_DATA_LOCKED` instead of overwriting.
4. Journal saves submit `baseUpdatedAt`; stale edits receive `409 JOURNAL_CONFLICT`.

## Scope limit

Bulk array save screens remain authoritative. V380 prevents simultaneous physical writes; it does not create automatic merge semantics for conflicting deletions from two separate bulk-admin sessions.
