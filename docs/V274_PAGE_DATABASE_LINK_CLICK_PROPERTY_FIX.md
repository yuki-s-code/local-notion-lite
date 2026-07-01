# V274 Page database link click/property fix

## Summary

This version fixes normal page links to databases. Database links inserted inside a normal page now behave like page and database-row links.

## Changes

- Added clickable database link format for BlockNote content: `#local-database=<databaseId>`.
- Kept backward-compatible parsing for `{{database:<id>}}`, `local-database://<id>`, readable `🗃️ title`, and markdown fallback `[[database:<id>|title]]`.
- Updated database insertion from the `/database` suggestion to insert an actual BlockNote link instead of plain text.
- Added database click handling in the normal page editor and side preview editor.
- Updated the page info Links tab so linked databases appear as clickable items.
- Kept database-row links and page links behavior unchanged.

## Non-goals

- No GitHub Actions changes.
- No package-lock changes.
- No kuromoji/node-nlp changes.
