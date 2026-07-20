# v703 Notebook flow and comparison

## Added without changing the analysis data store

- Markdown cells render headings and contribute to the notebook outline.
- Existing parameter and variable cells are surfaced in a compact active-parameter summary, including SQL reference counts.
- Existing dependency resolution is reused for a compact data-flow view. It does not execute queries or load additional result rows.
- Each executable cell shows its downstream impact before it is run.
- Existing local snapshots can be compared against the current loaded result sample.

## Performance guardrails

- The flow panel renders at most 80 nodes and uses a scroll container.
- The dependency graph uses an adjacency map instead of repeated full-edge scans.
- Snapshot comparison never fetches all rows. It compares at most 1,000 saved rows with at most 1,000 already-loaded current rows.
- No DuckDB schema, synchronization, query-route, or shared-workspace storage changes are introduced.
