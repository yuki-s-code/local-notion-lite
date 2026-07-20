# V765 Google Drive Content + Knowledge Graph

- Google Docs / Sheets / Slides / text files can be loaded through Drive API.
- Content retrieval runs in Electron main process; OAuth tokens never enter renderer.
- Retrieval is capped at 40,000 characters per file and 20 files per operation.
- Selected Drive cards can be synchronized from the whiteboard toolbar.
- Selected Page and Google Drive nodes can be connected in-place as a mixed Knowledge Graph.
- Existing nodes are reused; no duplicate cards are generated for selected-node graph creation.
- Existing links are checked to prevent duplicate pairs.
