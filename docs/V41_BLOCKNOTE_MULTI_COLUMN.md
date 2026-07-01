# v41 BlockNote Multi-Column Blocks

This version replaces the placeholder two-column draft with BlockNote XL Multi-Column support.

## Changes

- Adds `@blocknote/xl-multi-column` dependency.
- Creates the editor with `schema: withMultiColumn(BlockNoteSchema.create())`.
- Uses `multiColumnDropCursor` so blocks can be dropped beside each other.
- Merges default slash menu items, local workspace items, and official multi-column slash items using `combineByGroup`.
- Keeps the Multi-Editor Setup approach for the right preview drawer: the main editor and preview editor are separate BlockNote instances.

## Important

The previous fake `2カラム` slash item has been removed. Use the official multi-column slash menu items instead.
