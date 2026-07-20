# v632 — Editor responsiveness patch

## Changed

- Removed the workspace-wide `lightRefresh()` call from the normal page-save completion path.
  Autosaves no longer re-fetch the page tree, all databases, and all journals.
- Normal page saves now retain the editor-owned BlockNote document. The server response advances
  page metadata only, so a save does not remount BlockNote or disturb the caret.
- The visible page tree is patched in memory using structural sharing. Only the saved node and its
  ancestor chain receive new references.
- Side-panel history/link data is marked stale rather than eagerly re-read after every save.
  A checkpoint increments the visible history count locally.

## Expected effect

- Less input jank after autosave and Cmd/Ctrl+S.
- Fewer shared-folder reads during editing.
- Lower React reconciliation work in the sidebar and workspace shell.
- Fewer redundant save cycles caused by editor re-synchronization.

## Intentionally unchanged

- Explicit reload, page navigation, history restore, and remote/shared-folder refresh continue to
  replace document state when that is semantically required.
