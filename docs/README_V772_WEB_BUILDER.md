# V772 Web Builder

## Added

- HTML / CSS / JavaScript editor
- Sandboxed iframe live preview
- Non-blocking local autosave
- Desktop / tablet / mobile preview widths
- Console bridge for log, warn, error and runtime errors
- Standalone HTML export
- Dependency-free ZIP export containing index.html, style.css and script.js
- Blank, guide-site and dashboard templates
- Whiteboard Web Project card with live preview
- Page and database static snapshot insertion and manual refresh

## Architecture

`src/renderer/src/webBuilder` owns the reusable project model, compiler, local store, templates and exporters. `WebBuilderScreen` only coordinates UI. Whiteboard nodes store the Web Project ID instead of duplicating project source code.

The preview iframe uses `sandbox="allow-scripts"` without `allow-same-origin`, so preview JavaScript cannot access the parent application DOM, Electron APIs or local files.

Page and database integration is deliberately snapshot-based. The project does not continuously query workspace data while typing or previewing. A linked source is refreshed only when the user presses its update button.
