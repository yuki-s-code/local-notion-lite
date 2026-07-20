# v36 Lock and Local Link Open Fix

- Local page links no longer depend on browser navigation.
- `local-page://...` IDs are encoded/decoded safely.
- `/pages/:id/lock` now returns HTTP 200 with `{ editable: false }` when a page is locked, instead of causing a renderer-visible 400 error.
- Page opening is separated from edit-lock acquisition. A page can open in read-only mode even if lock acquisition fails.
- This prevents blank pages when clicking backlinks or inline page links.
