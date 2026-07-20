# V267 Database sidebar child page display fix

## Summary

Fixes the case where child pages created from a database row preview did not appear under the database row in the database sidebar tree.

## Changes

- Preserves `childPageIds` when reading persisted database row content.
- Prevents normal row-content autosave from sending stale `childPageIds` and accidentally clearing the child page list.
- Adds a fallback lookup for child pages whose `parentId` is `database-row:<databaseId>:<rowId>`.
- Dispatches a renderer event after creating a database-row child page so the database sidebar can expand and reload the target row immediately.
- Refreshes sidebar row child counts from both `childPageIds` and page `parentId` fallback.

## Notes

This keeps database-row child pages out of the normal page tree and displays them under the corresponding database row in the database sidebar tree.
