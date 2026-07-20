# v578 — DataFrame pipeline notebook

## Added
- Named SQL outputs. A SQL cell with output name `yearly_cost` can be queried by subsequent SQL cells as `result_yearly_cost`.
- DataFrame cells backed by Arquero for safe table transformations: filter, select columns, sort, and limit.
- Run All runs SQL and DataFrame cells in notebook order.
- SQL execution materializes only preceding named results as temporary DuckDB tables and removes them after execution.

## Safety
- User SQL remains SELECT/WITH only.
- Output identifiers are normalized to `[A-Za-z0-9_]` and are server-validated.
- DataFrame cells do not execute arbitrary JavaScript.
- Intermediate result tables are temporary and are not written to the shared folder or `analysis.duckdb`.

## Compatibility
- Existing SQL/parameter/markdown notebooks keep working.
- Existing SQL cells receive an empty optional output name.
