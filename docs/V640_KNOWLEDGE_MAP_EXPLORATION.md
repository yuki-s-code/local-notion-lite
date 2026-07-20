# V640 Knowledge Map Exploration

## Added UX
- Focus mode: restricts the existing in-memory graph to the selected node and 1–3 relation hops.
- Map search: highlights titles and tags without issuing a new server request.
- Relation preview: shows direct neighbours and the grounded relationship type in the inspector.
- Saved views: stores scope, filters, selected item, focus settings, search, zoom, and pan in localStorage only.

## Performance contract
No additional shared-folder reads, OCR scans, semantic searches, or graph indexes are started. All new exploration functions operate on the already-loaded bounded graph payload.
