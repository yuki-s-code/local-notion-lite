# V249 DatabaseTable component split

## Summary

This version continues the database UI refactoring started in V248.

## Changed

- Split reusable database helper functions into:
  - `src/renderer/src/components/database/DatabaseHelpers.ts`
- Split non-table database views into:
  - `src/renderer/src/components/database/DatabaseViews.tsx`
- Split fast table row/cell rendering into:
  - `src/renderer/src/components/database/DatabaseRows.tsx`
- Reduced `src/renderer/src/components/DatabaseTable.tsx` from roughly 2,169 lines to roughly 1,261 lines.
- Kept the public `DatabaseTable` component API unchanged.

## Not changed

- No package-lock changes.
- No GitHub Actions changes.
- No kuromoji usage added.
- No database schema change in this version.
- No route/API compatibility change.

## Notes

The next recommended step is to split `DatabaseTable.tsx` further into toolbar, schema editor, view settings, row detail drawer, import/export, and server-side paging controls.
