# V564 Journal Full-text Search

- Added a SQLite-backed `full_text` field for Journal summaries.
- Saves and restores update the Journal full-text index automatically.
- Added `GET /journals/search?q=...&limit=...`.
- Journal sidebar search now calls the endpoint after a short debounce.
- Results return a contextual excerpt around the first hit, so words from the latter half of an entry are discoverable.
- Existing SQLite indexes are upgraded lazily; older entries are rebuilt from the shared Journal files on first full-text search.
