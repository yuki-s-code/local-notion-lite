# v35 Local Link Navigation Fix

- Prevented `local-page://` links from opening a new Electron window.
- Added renderer-side capture handling for local page links before BlockNote/browser default link behavior.
- Added Electron main-process `setWindowOpenHandler` and `will-navigate` guards.
- Added a preload guard so accidental secondary windows do not crash on `window.localNotion.onReady`.
- The link lock 400 issue is expected only when another app instance owns the page lock; local link navigation itself no longer creates a broken second window.
