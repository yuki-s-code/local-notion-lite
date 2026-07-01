# V276 Page Link Icon Dedup Fix

## Summary

Fixed an issue where opening a normal page from a database link repeatedly caused the visible link label to accumulate resource icons such as `🧾 🧾` or `🗃️ 🗃️`.

## Cause

The BlockNote link title synchronization step re-created local resource links by adding a separate icon text node before the link. If the existing link text already included the same icon, the icon became part of the fallback title and was then wrapped again with another icon.

This mainly affected normal pages that linked to database rows or databases.

## Changes

- Added icon normalization helpers for database and database-row links.
- Stripped existing `🗃️` and `🧾` prefixes from link titles before re-rendering local links.
- Stripped trailing local resource icons before inserting regenerated local resource links.
- Updated markdown fallback generation so database and database-row link titles are saved without duplicated icons.
- Added legacy style-link normalization for database-row links as well as database links.

## Non-goals

- No database schema changes.
- No change to database preview, sidebar tree, or child page behavior.
- No package-lock or GitHub Actions changes.
- No kuromoji/node-nlp changes.
