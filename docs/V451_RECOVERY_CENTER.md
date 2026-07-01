# v451 Backup & Recovery Center

## Scope
- Shared JSON is the source of truth.
- A local recovery snapshot copies `manifest.json`, `pages`, `databases`, `journals`, `inbox`, `smart-assist`, and `workspace`.
- Attachments are intentionally excluded to avoid unexpectedly large snapshots.
- Local SQLite, sqlite-vec, FTS5, WAL/SHM, and interrupted-job state are disposable; recovery removes them and rebuilds from shared JSON.

## Retention
- Keep the latest 7 local snapshots under `<localCacheDir>/recovery-backups`.

## Operator flow
1. Create a snapshot before mass imports, tag merge, or major refactors.
2. When related search behaves abnormally, use **ローカルIndexを再構築**.
3. Run a difference update or background full rebuild.
4. Shared JSON is not modified by cache reset.
