# V389 Smart Assist settings and evaluation consistency

- Transformer and generation settings now use optimistic concurrency via `baseUpdatedAt`.
- Stale settings saves return `409 SETTINGS_CONFLICT` instead of silently overwriting a newer setting.
- Evaluation sets use the existing item-collection storage. Bulk import only upserts supplied entries and never deletes omitted entries.
- Evaluation entries have individual upsert/delete routes for future item-level UI.
- Evaluation reports remain append-free snapshot reports, written atomically under the shared JSON mutation lock.
