# V645 Knowledge map: relation evidence and time filtering

- Clicking an edge now opens an inspector that explains whether the connection is a direct link, backlink, parent/child relation, or shared tag.
- The inspector provides one-click jumps to either endpoint, so users can understand the connection before opening a page.
- A client-only time filter (7 / 30 / 90 / 365 days) filters by each node's existing `updatedAt` metadata. The current/selected node and relevant tags are retained for context.
- No shared-folder body, OCR corpus, semantic index, or AI model is read by these interactions.
- Edge selection is visual-only; it does not recompute the layout.
