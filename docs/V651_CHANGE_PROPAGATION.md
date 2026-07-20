# V651 Change Propagation

- Added targeted Semantic maintenance for Journals, including deletion as an empty-source replacement.
- Added subtree-aware page mutation responses and queues Semantic removal/rebuild for every affected descendant.
- Deleted page tasks are now removed with every page deletion path.
- Database schema changes queue row-level Semantic refreshes.
- Open knowledge maps subscribe to debounced workspace graph mutation events, avoiding stale maps while preventing autosave request storms.
- No global Semantic rebuild, OCR scan, or shared-folder full scan is triggered by these changes.

- Restoring a trashed database now performs a targeted row Semantic refresh.
- Database trash/restore emits a debounced knowledge-map refresh event.
- Shared-folder hard deletion remains intentionally conservative: absence alone is not treated as a deletion because SMB outages or partial mounts must never purge a valid local cache. It requires a durable tombstone/manifest protocol before safe automatic reconciliation can be enabled.
