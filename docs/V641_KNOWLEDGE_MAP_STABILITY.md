# V641 Knowledge Map Stability and Navigation

## Fixed

- A node click no longer starts dragging immediately. Dragging begins only after a pointer move of at least 7px.
- A click now only selects the node and updates the inspector. Node positions are unchanged.
- Node positions continue to be written locally only after a real drag completes.

## Added

- Node position locking, stored locally per map scope.
- “Arrange unlocked nodes” that preserves fixed positions.
- A compact interactive minimap for recentering the view.
- Shortest-path highlighting across currently visible relations. It never invokes semantic search, OCR, or a shared-folder scan.

## Performance

All features operate only on the graph already loaded for the map. No new workspace-wide index or background data source is introduced.
