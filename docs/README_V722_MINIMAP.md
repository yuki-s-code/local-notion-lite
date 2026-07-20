# v722 - Minimap readability polish

- Made the current viewport overlay translucent and VS Code-like so underlying minimap lines remain visible.
- Reduced minimap line thickness, indentation, width, and opacity to avoid column crowding.
- Lowered rendered segment density to make long documents easier to scan.
- Kept the minimap lazy-mounted from the right utility panel.

Checks performed:
- node scripts/check-styles.mjs
- esbuild transpile check for PageMiniMapPanel.tsx
