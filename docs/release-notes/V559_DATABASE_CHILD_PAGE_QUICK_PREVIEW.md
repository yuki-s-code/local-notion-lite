# V559: Database Child-Page Quick Preview

- Hovering a database-row child page in the sidebar now shows a compact preview.
- The card displays its database and row path, updated time, a short plaintext excerpt, and up to five tags.
- The feature reuses `PageWithLock.previewSnippet` already returned with expanded child pages; hover causes no new API request, shared-folder read, or editor mount.
- Clicking retains the existing workspace-tab open flow.
- The viewport-safe portal position and internal scrolling introduced in v558 apply unchanged.
