# Analysis cache and cancellation audit (v630)

## Goal
Keep the analysis notebook responsive during long sessions without changing saved notebook data, DuckDB source tables, or Semantic indexing.

## Changes

### Result-cache memory guard
- Keeps the existing 15-minute TTL and four-result limit.
- Adds a 96 MiB soft memory budget based on a sampled result-size estimate.
- Evicts the least-recently-used cached result first, rather than insertion order.
- Touches cache entries when result pages, full-result compatibility reads, CSV exports, or named-result materialisation access them.
- Always retains at least the newest result. A query result that individually exceeds the soft budget remains usable for paging and downstream cells rather than being immediately evicted.
- Adds `DELETE /analysis/results/:resultId` and `GET /analysis/results-cache/status` for future diagnostics or explicit release controls.

### Cancellation
- Adds a per-run `AbortController` in the analysis notebook screen.
- The header and running-cell UI expose an explicit stop action.
- SQL, Pivot, and legacy full-result fetches receive the abort signal.
- Cancelling prevents a late response from committing results or execution history to the current notebook.
- DuckDB work already started on the local server may complete before its request handler returns; cancellation is therefore UI/request cancellation, not an unsafe forced interruption of the shared DuckDB connection.

## Performance characteristics
- No all-result serialisation is used to estimate cache memory; only up to 512 rows are sampled.
- Cache cleanup does not touch workspace source data or execute a DuckDB sync.
- Cancellation does not create new index work or alter cached source tables.

## Verification
The following changed files were bundled successfully with esbuild:
- `AnalysisNotebookScreen.tsx`
- `api.ts`
- `analysisNotebookService.ts`
- `app.ts`
- `vaultService.ts`

A full project typecheck was not run in this environment because the uploaded archive does not include its Node/Electron dependency tree.
