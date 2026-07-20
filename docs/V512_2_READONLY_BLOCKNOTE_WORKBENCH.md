# v512.2 Read-only BlockNote workbench

- Comparison and split panes now render saved BlockNote content using a dedicated read-only editor instance.
- Each preview pane is isolated from the editable page editor: it has no save callback, no autosave, no history creation, no AI editing controls and no database editing state.
- Preview editor keys include page ID and `updatedAt`, so saved source content recreates the read-only renderer cleanly instead of reusing a stale Tiptap instance.
- Page save conflict detection now treats any shared `updatedAt` change since `baseUpdatedAt` as a conflict, even when a local cache import has already updated SQLite.
- Shared JSON mutation lock lease was extended from 30 seconds to 120 seconds and the bounded wait from 4 to 12 seconds, reducing false stale-lock recovery on slow SMB/NAS shares.

## Operational note
This is a view-only companion pane, not CRDT-based collaborative editing. The main page remains the only editable document instance.
