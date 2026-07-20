# v724 Minimap glass + text color polish

## What changed

- Reworked the page minimap line rendering so each segment can carry a color.
- The minimap now extracts explicit text colors from Markdown/HTML-like output when available:
  - inline style `color: ...`
  - `<font color="...">`
  - `textColor`, `text_color`, `color` style-like metadata
  - `{ color: ... }` / `{ textColor: ... }`
- It also derives useful fallback colors from links, inline code, bold, strikethrough, marks/highlights, headings, lists, code, quotes, and dividers.
- Made the current viewport overlay a frosted-glass frame rather than another blue overlay.
- Reduced segment thickness and total segment count to prevent thick lines from overlapping.
- Updated the legend to show text-color reflection and the glass viewport frame.

## Files changed

- `src/renderer/src/components/screens/PageMiniMapPanel.tsx`
- `src/renderer/src/styles/app.css`

## Checks

- `npm run check:styles` passed.
- `PageMiniMapPanel.tsx` TypeScript parse was checked with global `tsc`; only missing React dependency/type errors appeared because `node_modules` is not included in the ZIP.
- `src` generated `.js` count: 0.
