# V463 — AI Assistant Icon-only FAB

## Changed

- Removed all persistent visible text from the floating AI assistant button.
- Retained an accessible `aria-label` and hover title for assistive technology and pointer users.
- Kept the assistant as a compact SVG sparkle glyph.
- Replaced the old generation label and spinner with an animated orbit ring, subtle breathing, and spark twinkle.
- Added a reduced-motion fallback that preserves the generating state without animation.

## Behavioral contract

- Pressing the icon opens the AI chat drawer.
- Closing the drawer during generation does not cancel generation.
- The icon alone communicates idle versus generating state; no status copy is displayed in the FAB.
