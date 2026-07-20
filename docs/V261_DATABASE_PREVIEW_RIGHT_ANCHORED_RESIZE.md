# V261 Database preview right-anchored resize

## Summary

Fixes the V260 database row preview resize behavior. The preview drawer is placed on the right side, so resizing must expand toward the left. V260 allowed layouts that could visually grow toward the right and be clipped by the viewport.

## Changes

- The database preview column now uses a CSS custom property: `--db-row-preview-width`.
- The table/detail layout reserves space using CSS grid:
  - left: `minmax(0, 1fr)` table area
  - right: `minmax(360px, var(--db-row-preview-width, 520px))` preview area
- The preview drawer is right-aligned with `justify-self: end`.
- Native browser `resize: horizontal` was disabled because it resizes from the bottom/right edge and can push content out of the viewport.
- Only the custom left-side resize handle is used.
- Width is clamped in TypeScript based on viewport size, leaving a minimum table area.
- On narrow screens, the preview falls back to full-width stacked layout and hides the resize handle.

## Files changed

- `src/renderer/src/components/DatabaseTable.tsx`
- `src/renderer/src/styles/app.css`
- `src/renderer/src/styles.css`
