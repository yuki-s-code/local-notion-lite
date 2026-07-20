# v725 Minimap Real Fix

- Passes BlockNote blocks directly into PageMiniMapPanel so minimap can use real inline text styles. Markdown export loses `textColor`, so v724 could not show real editor colors.
- Renders multi-color inline runs inside a block as separate thin minimap segments.
- Fixes segment button default padding/appearance, which made lines look thick and overlap on some browsers/Electron/macOS.
- Rebuilds the current viewport as a frosted glass frame with blur/saturate/inner highlights and visible transparent background.
- Keeps lazy mount behavior: minimap is only parsed/rendered when the minimap tab is open.
