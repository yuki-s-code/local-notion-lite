# v112 Block comments and change timeline

This version adds safe block-level comments without modifying BlockNote internals.

## Design

- Page-level comments are preserved.
- Block-level comments are stored as metadata in `pages/{pageId}/comments.json`.
- A comment may include `blockId` and `blockPreview`.
- The BlockNote document itself is not modified when comments are created.
- This avoids custom marks, custom inline styles, and DOM mutation inside BlockNote.

## Change timeline

The page history tab now shows a timeline-style view combining:

- current page update
- saved history entries
- comments
- resolved comments

History preview, diff, and restore actions remain available from timeline entries.
