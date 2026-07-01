# V527 — Workspace tab lifecycle fix

## Fixed
- Removed the duplicate legacy database-only tab bar. Page and database tabs now use the workspace tab state only.
- Closing a workspace tab no longer immediately recreates it because of an effect triggered by the tab list mutation.
- Closing the active tab selects a remaining tab; a page fallback is opened in the main editor.
- Closing the final tab is allowed. The underlying editor remains available, but no closed tab is silently restored.
- Context-menu wording now matches the actual action.

## Efficiency
- The current-page registration effect only runs when the primary page navigation changes, not whenever the tab list changes.
