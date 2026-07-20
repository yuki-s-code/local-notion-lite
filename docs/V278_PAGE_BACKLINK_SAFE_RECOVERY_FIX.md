# V278 Page Backlink Safe Recovery Fix

## Summary

Fixes a regression introduced by the DB-row-to-page backlink scan where opening a normal page could fail if `/pages/:id/backlinks` returned 400.

## Changes

- Fixed the DB-row backlink regular expression for normal page links.
  - The previous `@[[...|pageId]]` regex string was not escaped safely in `new RegExp(...)`.
- Wrapped the database-row backlink scan in a safe `try/catch`.
  - A failure while scanning DB row bodies no longer prevents the normal page from opening.
- Encoded page IDs in the renderer backlink API call.
- Made page open / save / history restore resilient to backlink request failure.
  - If backlinks fail, the page still opens and shows an empty backlink list instead of crashing the workflow.

## Not changed

- Database preview behavior
- Database sidebar behavior
- Database row child pages
- kuromoji / node-nlp
- package-lock / GitHub Actions
