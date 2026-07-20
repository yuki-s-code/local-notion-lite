# v293 Smart Assist Admin Scroll Fix

## Summary

Fixes the Smart Assist admin modal so the newly added `関連Index` tab scrolls correctly on small screens and in preview-sized windows.

## Cause

The v232 admin modal layout intentionally made each tab content area a flex child with `overflow-y: auto`. Later, v292 added two new tab panels:

- `smart-admin-model-panel-v236`
- `smart-admin-semantic-panel-v292`

Those panels were not included in the scrollable-content selector, so their content could be clipped by the modal's `overflow: hidden` container.

## Fix

Added both panels to the modal scroll rules and added a v293 defensive override:

- `flex: 1 1 auto`
- `min-height: 0`
- `overflow-y: auto`
- consistent padding and scrollbar styling

The semantic panel background is also reset to avoid a nested card occupying the entire scroll container.

## Verification

Open Smart Assist 管理画面 > 関連Index and verify:

1. The tab content scrolls when the window is short.
2. The lower guide/error detail sections are reachable.
3. AIモデル tab also scrolls when its content exceeds the modal height.
4. Header, lead text, tabs, and progress bar remain fixed while only the tab content scrolls.
