# v50 @ Link Recovery

- Restores @ page-link suggestions after the v49 pinned database layout change.
- Moves page-link suggestions to BlockNote SuggestionMenuController with triggerCharacter="@".
- Removes the old floating @ suggestion panel to avoid overlay and focus conflicts.
- Keeps / slash menu and multi-column blocks on BlockNote official controllers.
- Raises suggestion menu z-index so pinned database rails do not visually cover it.
