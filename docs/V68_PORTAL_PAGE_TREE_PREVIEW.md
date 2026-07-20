# v68 Portal Page Tree Preview

Page tree hover previews are now rendered through a React portal attached to `document.body`.

This avoids the preview being hidden behind BlockNote editor stacking contexts, menus, and scroll containers.

Changes:

- Moves tree hover previews out of the sidebar DOM flow.
- Uses a fixed high-z-index portal layer.
- Keeps page tree row height stable.
- Shows title, metadata, tags, child counts, and body excerpt.
- Hides previews on narrow screens.
