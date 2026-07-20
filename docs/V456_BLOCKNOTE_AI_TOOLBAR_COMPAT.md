# v456 — BlockNote AI toolbar compatibility

## Fix
The previous contextual AI toolbar was rendered near the native BlockNote selection toolbar and could overlap it.

## Behavior
- The native BlockNote selection toolbar is never covered by an AI overlay.
- The AI entry point remains fixed at the lower-right edge of the viewport.
- When text is selected, the button changes to `選択範囲をAI編集` and shows a small `選択済み` state.
- The existing floating AI editing panel still opens without moving the document or replacing BlockNote controls.
