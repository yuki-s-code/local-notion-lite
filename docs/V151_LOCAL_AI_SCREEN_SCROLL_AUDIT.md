# v151 Local AI Screen Scroll Audit

## Fixes

- Converted the FAQ Builder area into a dedicated modal.
- Added independent scroll containers for:
  - Chat log
  - Chat composer
  - FAQ/right side panel
  - FAQ Builder modal body
  - FAQ list inside the builder
  - JSON import modal body
  - Detail tools modal body
- Hardened overflow/min-width behavior to prevent nested flex/grid containers from blocking scroll.
- Added responsive layouts for desktop, medium-width, and narrow screens.

## Why

The previous inline FAQ Builder expanded inside a fixed chat layout. This caused multiple nested `overflow: hidden` containers to compete, making the bottom of the screen unreachable. v151 moves high-density management screens into modal flows where close buttons and internal scrolling stay accessible.
