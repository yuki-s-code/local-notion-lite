# v72 BlockNote stable slash fix

This build keeps the v72 UI baseline and focuses on BlockNote stability.

Fixes:
- BlockNote editor is recreated only when the page id changes, not on every page title/upload callback change.
- Slash and @ suggestion controllers are rendered after the editor is mounted.
- File upload uses BlockNote standard `uploadFile`, with the latest app uploader stored in a ref.
- Local page title synchronization no longer replaces the whole editor document during active typing.
- Link click handling is scoped to the current editor shell.
