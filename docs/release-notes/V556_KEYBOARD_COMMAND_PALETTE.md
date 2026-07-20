# V556 Keyboard-first Command Palette

## Goal
Improve the existing `Cmd/Ctrl + K` command palette without adding a duplicate navigation surface.

## Improvements
- Filters actions as well as pages, databases, journals, inbox items, tasks, and attachments.
- Supports space-separated multi-word search.
- Supports `↑` / `↓` to move through results and `Enter` to run the selected command.
- Scrolls the active result into view.
- Adds primary quick actions when the search field is empty.
- Resets the previous query when the palette is closed, so the next opening starts cleanly.
- Adds semantic dialog/listbox ARIA attributes.

## Compatibility
No page, database, attachment, or shared-folder data is changed. This is renderer-only UX state.
