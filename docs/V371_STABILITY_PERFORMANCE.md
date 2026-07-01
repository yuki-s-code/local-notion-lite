# V371 Stability & Performance Pack

## Goal
Maintain existing features while reducing background work on constrained company PCs and strengthening the Electron-to-local-API boundary.

## Changes
- Local API uses an ephemeral per-launch renderer token.
- API server shutdown stops the managed llama-server and closes SQLite.
- Shared-folder lightweight refresh runs every 45 seconds and pauses when the application is hidden or a page/database is being edited.
- Semantic idle updates poll every 15 seconds instead of every 5 seconds and pause while hidden.
- DB condition extraction ranks candidates from row properties before loading row body files; only top candidates load their body content.
- DB and AI date conditions use Asia/Tokyo date boundaries.

## User-visible behavior
No feature is removed. Background synchronization remains active while the app is visible and idle. Manual refresh, full reindex, DB search, and AI chat continue to work as before.
