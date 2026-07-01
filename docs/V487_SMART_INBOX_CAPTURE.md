# V487 Smart Inbox Capture

- Inbox accepts drag-and-drop/file-picker capture for PDF, Office files, images, and text.
- Files are saved under the existing shared Inbox storage (`inbox/attachments/<inbox-item-id>`), not the page attachment store.
- Each capture retains an Inbox item with attachment metadata; existing page, Journal, archive, and delete actions remain unchanged.
- The UI offers local, non-AI organization hints. It never auto-creates tasks, pages, FAQ entries, or project links.
- Uploads use the existing base64 attachment policy (15 MiB per file).
