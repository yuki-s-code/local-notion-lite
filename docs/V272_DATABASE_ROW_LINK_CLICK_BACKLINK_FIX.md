# V272 Database row link click/backlink fix

## Summary

This update makes database-row links inserted from ordinary pages behave as first-class internal links.

## Changes

- Converted markdown fallback links like `[[dbrow:<databaseId>:<rowId>|Title]]` back into clickable BlockNote links when a page is re-opened.
- Added database-row title synchronization in BlockNote documents, similar to existing local page link title synchronization.
- Preserved DB-row links as `[[dbrow:...|...]]` when saving markdown.
- Improved database-row backlink detection by scanning both page markdown and stored BlockNote JSON.
- Kept `local-dbrow://<databaseId>/<rowId>` as the runtime click target.

## Behavior

- Clicking a DB-row link inside a normal page opens the target database and row preview.
- Re-opening a page no longer turns DB-row links into inert plain text.
- DB-row preview backlinks can detect links created inside normal page BlockNote content.
