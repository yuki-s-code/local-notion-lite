# Analysis Notebook Lazy-Loading Audit — v624

## Scope

Reviewed the analysis notebook list, notebook opening, dashboard pin navigation, and local SQLite persistence paths.

## Finding

The notebook sidebar called `GET /analysis/notebooks`, and `listNotebooks()` selected and JSON-parsed `cells_json`, `execution_history_json`, and `snapshots_json` for every saved notebook. This is unnecessary for a sidebar that only renders title and timestamp. It makes startup and every `refresh()` cost proportional to the size of all saved notebook definitions and snapshots.

## Change

- Added `AnalysisNotebookSummary` for list-only metadata.
- `listNotebooks()` now reads only `id`, `title`, `description`, `created_at`, and `updated_at`.
- Added a renderer API call for `GET /analysis/notebooks/:id`.
- Sidebar notebook selection and dashboard-pin navigation now load full notebook JSON only for the selected notebook.
- Deleting the active notebook opens the next remaining notebook lazily rather than treating its summary as a full notebook.

## Performance effect

- Sidebar load and `refresh()` avoid parsing cell/history/snapshot JSON for unopened notebooks.
- Memory transferred to the renderer becomes bounded by notebook metadata rather than the aggregate size of every notebook.
- No analysis result rows, DuckDB sync logic, or shared workspace data are changed.

## Validation

- Changed renderer screen and analysis service passed esbuild syntax transformation.
- `npm run typecheck` reached the project configuration but could not resolve `electron` and `node` type definitions because the supplied archive does not contain the required dependencies.

## Remaining high-impact analysis work

`AnalysisNotebookScreen` still hydrates complete query results for DataFrame, function, pivot, summary, quality, and preprocessing cells. The next major performance phase should move those transformations to DuckDB/server-side result caches and return only paged or aggregated output to the renderer.
