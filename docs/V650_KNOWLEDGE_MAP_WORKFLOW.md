# V650 Knowledge Map Workflow

- Cluster name suggestions are derived only from already-displayed graph edges and metadata.
- Health scoring, comparison, and timeline controls reuse memoized graph state; no OCR, semantic-index, or shared-folder scan is triggered.
- Creation from the map uses the established page creation API and keeps data writes explicit.
- Timeline playback changes only the existing client-side time filter and is cleared on unmount.
