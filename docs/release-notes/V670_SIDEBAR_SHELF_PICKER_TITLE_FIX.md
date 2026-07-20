# V670 Sidebar Bookshelf Picker Title Fix

## Fixed

The sidebar context-menu bookshelf picker inherited the generic menu icon CSS rule. That rule forced direct `span` elements to a 16px flex basis, so shelf names could render as only their first character.

The picker now gives shelf-name labels a flexible content column, keeps the item count fixed at the right edge, truncates only when the full menu width is exhausted, and retains the native `title` tooltip with the complete shelf name.

## Documentation placement

Release and implementation notes are created under `docs/release-notes/`; new top-level Markdown files should not be added except for repository entry-point documentation such as `README.md`.
