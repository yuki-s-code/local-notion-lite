# Analysis Incremental Sync Audit — v631

## Goal
Avoid rebuilding every DuckDB analysis table after a small page, database-row, journal, or task change.

## Implementation
- Added a local SQLite change log (`analysis_source_change_log`) maintained by triggers on analysis source indexes.
- After one full baseline sync, changed source keys are coalesced and only those rows are deleted/reinserted in DuckDB.
- Database metadata changes refresh only the database metadata row. A database-row scope refresh is used only on creation, deletion, or trash-state changes because these affect row visibility.
- Deletions and trash moves remove stale DuckDB rows even when the original SQLite source is no longer queryable.
- A sync that sees an unexpected source fingerprint change without a corresponding local change-log entry falls back to a full rebuild.

## Safety boundary
Incremental sync runs only when the prior full sync included all source rows within the 100,000-row cap. Capped workspaces keep full rebuild behavior, preventing an edited row outside the sampled set from biasing the analysis cache.

## UI
`lastSyncMode` now includes `incremental`; the reliability panel displays `変更分のみ反映`.

## Verification
- Trigger SQL shape was exercised against SQLite in an isolated schema.
- Service, shared types, and renderer screen passed esbuild syntax transformation.
- Full `npm run typecheck` could not start because this ZIP does not include the Electron and Node type definitions (`@types/electron`, `@types/node`).
