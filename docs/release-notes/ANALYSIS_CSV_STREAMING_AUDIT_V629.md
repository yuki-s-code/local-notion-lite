# Analysis CSV Streaming Audit v629

## Objective

Avoid returning a large cached analysis result to the Electron renderer as one JSON payload when the user exports CSV.

## Change

- Added `AnalysisNotebookService.streamResultCsv()`.
  - Reads the existing result cache.
  - Emits the header and one row at a time.
  - Uses CSV escaping for commas, quotes, CR, and LF.
  - Does not build one monolithic CSV string.
- Added `GET /analysis/results/:resultId/export.csv`.
  - Sends CSV with UTF-8 BOM for spreadsheet compatibility.
  - Uses HTTP response backpressure (`drain`) before producing more rows.
  - Keeps the local API token requirement.
- Added `ApiClient.downloadAnalysisResultCsv()`.
  - Fetches the export as a Blob instead of JSON.
- Updated the analysis result panel.
  - Large paged results export through the streaming endpoint.
  - Small results continue to use the existing in-renderer export path.

## Efficiency impact

Before this change, exporting a result with more than one displayed page called `/analysis/results/:id/all`, creating a second full result representation as JSON in the renderer and then another CSV string.

After this change, the server writes rows progressively and the renderer receives a CSV Blob. The result cache remains the single in-memory source of rows; no additional all-row JSON payload or all-row renderer transformation is created.

## Compatibility

- `/analysis/results/:resultId/all` remains for the small set of legacy analysis transforms that have not yet been migrated to DuckDB. It is not used for large CSV export.
- Result paging, charts, SQL execution, result cache expiry, and DuckDB pipeline operations are unchanged.

## Verification

- Reviewed request/token handling: the export endpoint remains behind the standard local API token middleware.
- Reviewed CSV escaping and UTF-8 BOM handling.
- Reviewed response backpressure handling to avoid buffering a large export in Express.
- Full project `typecheck` must be run in the project environment with installed dependencies.
