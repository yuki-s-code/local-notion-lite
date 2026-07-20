# v549 — Comparison picker includes all DB-row child pages

## Fixed

The comparison and split reference pickers loaded DB-row child-page references correctly, but then filtered page candidates using only the ordinary page tree. Because DB-row child pages are intentionally absent from that tree, every child page except a currently selected/otherwise-open item was removed from the dropdown.

The candidate filter now accepts a page when it exists in either:

- the ordinary page tree,
- the currently open page, or
- the DB-row child-page relationship-index results.

This applies to both comparison selectors and the split reference selector.
