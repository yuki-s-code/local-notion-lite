# v544 — Tab close and trash transitions

## Fixed lifecycle behavior

- Closing the final workspace tab clears the previous page surface and shows an explicit empty workbench state.
- Closing an active tab selects the remaining tab; a page fallback is loaded through the normal page navigation pipeline.
- Moving the active page to Trash synchronously informs the workbench before the primary surface is cleared. When another tab exists, it becomes active instead of leaving an empty page area.
- The sidebar selection is cleared when the final tab is closed.

## Design rule

The tab rail is the source of truth for what is visible. `current` remains a page-data cache for the renderer and must not by itself keep an old editor visible after its tab has closed.
