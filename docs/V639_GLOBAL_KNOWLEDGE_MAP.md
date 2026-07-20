# v639 Global Knowledge Map

Adds a bounded workspace-wide 2D constellation map alongside the page-local map.

- Uses only SQLite `workspace_link_index` and page metadata.
- Does not scan shared folders, page bodies, OCR text, embeddings, or AI data.
- Ranks connected/recent pages and caps the graph at 320 nodes by default.
- Includes only tags shared by two or more displayed pages.
- Keeps local and global node positions separately in browser-local storage.
