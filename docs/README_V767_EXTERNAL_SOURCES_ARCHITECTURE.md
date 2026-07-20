# V767 External Sources architecture

## UX direction

Google Workspace is treated as an external data source, not as a permanent whiteboard block palette.

- The main sidebar opens a dedicated External Sources screen.
- Drive, Calendar and Gmail are browsed in that screen.
- A selected item is placed into a small deduplicated handoff queue.
- Opening the whiteboard consumes the queue and creates normal whiteboard nodes.
- Google Docs/Sheets export remains in the whiteboard header because it is an action on the current board rather than a source browser.

## New files

- `ExternalSourcesScreen.tsx`
- `googleWorkspaceQueue.ts`

## Removed

- `GoogleWorkspacePanel.tsx`
- Google Workspace mode from the whiteboard block palette.
- Board-specific Google synchronization callbacks that became unreachable after the UI move.

## Safety and compatibility

Existing `google-drive`, `google-calendar` and `google-gmail` nodes are unchanged.
The handoff queue validates item kind and ID and keeps at most 50 unique entries.
