# Sub-item duplication bugfix (v607)

## Cause
The v606 hierarchy renderer could emit a row more than once if a legacy/imported parent relation formed a cycle, or while a parent relation changed during a rerender. The table then looked as if rows had been duplicated even when the database rows were not duplicated.

## Fixes
- Hierarchy flattening now uses an `emitted` set, so a row ID can be rendered exactly once.
- Sub-item parent assignment is normalized to zero or one valid parent.
- Selecting self or a descendant as a parent is rejected before saving.
- Server normalization repairs imported/legacy sub-item data by clearing invalid multi-parent/cyclic links.

The repair changes only the dedicated sub-item parent cell. It does not duplicate, delete, or alter any row's other properties or row body.
