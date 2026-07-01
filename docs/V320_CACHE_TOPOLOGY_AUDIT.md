# V320 Cache Topology Audit

## Purpose

V320 clarifies the difference between the existing local SQLite database and the V319 Ruri-v3 semantic SQLite cache.

## Key point

The application already uses SQLite. That existing SQLite database is mainly an application display/search index:

- pages
- page_fts
- database_row_index
- database_row_fts
- smart_faq_index
- smart_faq_fts

V319 added a separate user-selected local SQLite database for AI semantic search:

- semantic_items
- semantic_meta
- query_cache

The shared folder remains the source of truth. SQLite is used as a rebuildable local cache/index layer.

## Added

- GET /smart-assist/cache-topology
- api.getCacheTopology()
- Smart Assist model settings panel cache topology display
- Current SQL/cache explanation
- Existing local SQL table counts
- Ruri-v3 semantic cache status
- Next cache target recommendations

## Recommended next step

V321 should add safe differential cache for pages, journals, and database catalog metadata before deeper database-row relation caching.
