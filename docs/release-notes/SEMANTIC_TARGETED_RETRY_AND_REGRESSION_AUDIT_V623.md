# V623 Semantic targeted retry and regression tests

## Purpose
This release protects the incremental Semantic update path from regressions without introducing workspace-wide reads during normal editing.

## Changes
- Added a shared, dependency-free semantic target policy used by both the renderer queue and `VaultService`.
- Normalizes, validates and deduplicates page and DB-row targets; DB rows remain distinct across databases.
- Added regression tests for target parsing, deduplication and the 20-target batch boundary.
- Changed administrator “reindex source” retries to rebuild only the selected page or DB row rather than collecting the entire workspace first.
- The retry API now accepts `databaseId`, so a DB row that is absent from an old/broken index can still be rebuilt directly.

## Performance
- Normal editing and source retry do not enumerate unrelated page bodies, database-row bodies, or journals.
- Full rebuild and full diagnostic diff remain explicit full-workspace operations.

## Validation
- `semanticTargetPolicy.test.ts` passes via Node’s test runner after bundling with esbuild.
- Changed server and renderer files were syntax-transpiled with esbuild.
- Full project `npm run typecheck` requires installed project dependencies.
