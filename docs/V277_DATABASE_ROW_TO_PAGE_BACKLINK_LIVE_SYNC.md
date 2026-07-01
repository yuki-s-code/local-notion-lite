# V277 Database row preview to page backlink live sync

## Summary

- Added page backlink detection from database-row preview bodies.
- Normal pages now show database rows as backlink sources when a DB-row preview links to that page.
- Added a renderer event after DB-row content autosave so the currently open normal page refreshes backlinks without a full app reload.
- Extended `BacklinkInfo` with optional database-row source fields while keeping normal page backlink fields compatible.

## Notes

- Relation properties remain separate from free-text links.
- The backlink scan reads both row-content markdown and saved BlockNote JSON so `#local-page=<pageId>` and legacy local page links are detected.
