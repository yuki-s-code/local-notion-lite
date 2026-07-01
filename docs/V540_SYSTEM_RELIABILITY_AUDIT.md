# v540 System reliability audit

## Fixed

- Parent-page trash now checks locks on every descendant before any data is modified.
- Restoring a trashed parent restores its trashed descendants as one subtree.
- Broken-link reports merge cached broken links with live links whose targets are now trashed/missing.
- Database sidebar row/child reads use monotonic request versions to prevent slow stale responses from overwriting newer save/delete results.
- Ordinary page-tree events no longer reload every expanded database from a shared folder.

## Verification focus

1. Open/edit a page, DB, DB row and child page; switch tabs and confirm sidebar selection.
2. Trash a parent with a locked child from another app instance: operation must fail before any page moves.
3. Trash and restore a parent with children: children must return with it.
4. Save/delete DB child pages while the database sidebar is expanded: list must not revert after a slow read.
5. Trash a page targeted by links while other broken links exist: it must appear in broken-link results.
