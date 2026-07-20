# V687 — Selection-adjacent AI edit action

When text is selected in BlockNote, the AI edit trigger is now rendered next to the selected range using a body portal. The default editor AI action remains available only when there is no selection.

## Behaviour

- Selection bubble follows the selected text in viewport coordinates.
- The bubble opens below the selection near the top of the viewport and above it otherwise.
- `mousedown` preserves the text selection before the click opens the AI edit panel.
- The trigger is dismissed on scroll, resize, or when the selection leaves the editor.

This avoids forcing the user to return to the editor header for a selection-specific edit.
