# V332 Workspace Derived Indexes

## Goal

Improve page transition and utility screen performance on slower office PCs by removing repeated full scans from frequently used paths.

## Added indexes

V332 adds local SQLite derived indexes. They are cache/index data, not the source of truth.

- `page_search_index`
- `page_search_fts`
- `workspace_link_index`
- `attachment_index`
- `broken_link_index`

## Optimized areas

- Backlinks now read from `workspace_link_index` instead of scanning all page markdown each time.
- Database-row backlinks are indexed from row content when row content is saved or the index is rebuilt.
- Attachments list now reads from `attachment_index` instead of reading every page's `attachments.json` on every request.
- Broken links are read from `broken_link_index` or derived from indexed links whose target page no longer exists.
- Page search metadata is stored in `page_search_index` / `page_search_fts` for future page-candidate and @link optimizations.

## Rebuild / diagnosis

New server endpoints:

- `GET /workspace-derived-index/status`
- `POST /workspace-derived-index/rebuild`

Smart Assist settings adds:

- `リンク・添付Index確認`
- `リンク・添付Index再構築`

## Update policy

- Page save updates only that page's derived indexes.
- Database-row content save updates only that row's link index.
- Attachment add currently refreshes attachment index.
- Full rebuild is available if caches are missing or stale.

## Notes

The indexes are safe to rebuild. If they are missing, the backlinks path performs a one-time rebuild fallback so older vaults do not show empty results.
