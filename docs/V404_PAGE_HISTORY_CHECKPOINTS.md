# v404 Page History Checkpoints

## Policy

- Autosave persists content after the existing debounce delay. It does not create a history snapshot.
- The first changed save after five minutes since the latest checkpoint creates an `auto_checkpoint` history entry.
- Ctrl+S / Cmd+S creates a `manual` checkpoint when there is an unsaved change.
- Page-level metadata changes (title, icon, properties, scope) create a `metadata_changed` checkpoint.
- Page navigation and application shutdown flush content but do not create a checkpoint.
- Restoring a history entry keeps the existing `restore_before` backup behavior.

This separates recovery-grade autosave from user-facing version history.
