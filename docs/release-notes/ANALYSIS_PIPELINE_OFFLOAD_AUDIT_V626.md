# Analysis Pipeline Offload Audit v626

## Goal
Move high-volume analysis operations out of `AnalysisNotebookScreen` so the renderer does not call `/analysis/results/:id/all` for common preprocessing and data-quality work.

## Implemented

### DuckDB-side preprocessing
The following preprocess operations now create a safe SQL query against the temporary upstream result table:

- duplicate removal (`ROW_NUMBER ... PARTITION BY`)
- missing-value handling: drop rows, custom value, zero, mean, median
- trim text
- numeric coercion
- date coercion
- exact value replacement
- IQR / three-sigma outlier exclusion

`forwardFill` and Unicode NFKC normalization retain the legacy renderer implementation because their existing semantics are order-dependent or JavaScript-specific. This preserves behavior rather than silently changing results.

### DuckDB-side quality checks
Quality cells now calculate on the server for:

- missing values per selected column
- duplicate rows based on selected columns
- non-numeric populated values

The result remains a small summary table (`check`, `column`, `issue_count`, `rate`, `status`).

## Efficiency impact

- Upstream result rows remain in the service result cache and are materialized only inside DuckDB for the requested pipeline step.
- The renderer receives only the standard first result page (normally 500 rows), not the entire upstream dataset.
- No background scans, periodic work, Semantic updates, or shared-folder writes were added.
- Existing result-cache expiry behavior remains unchanged.

## Intentionally retained legacy paths

- dynamic cross-tab pivot: requires discovery of dynamic output columns; kept on the compatibility path.
- advanced `function` cells: still use the existing renderer implementation pending operation-by-operation SQL parity tests.
- `forwardFill` and `normalizeText` preprocessing: retained for semantic compatibility.

## Validation

- `AnalysisNotebookScreen.tsx` passed esbuild TSX transformation.
- Full project `typecheck` could not be run in this archive because dependencies are not bundled.
