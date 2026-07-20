# V524 — Unified editable database-tab UX

## Fixed user-facing problems

### 1. Shared / Private controls disappeared from database tabs
The workspace database tab now exposes the same `Private` and `Shared` scope toggle used by the classic database editor. The controls call the existing database scope persistence API, retain the current database contents, and refresh the sidebar after a scope move.

### 2. Database editing immediately raised a conflict
Workspace-tab edits previously bypassed the existing save coordination and could re-save stale local snapshots when a `DatabaseTable` instance unmounted. The implementation now:

- serializes saves per database ID;
- bases every write on the last server-confirmed `updatedAt`;
- coalesces rapid cell edits while a save is in flight;
- does not replay a previously committed snapshot during component unmount;
- keeps the table mounted across server `updatedAt` changes.

### 3. Creating a database opened the legacy standalone database screen
Shared and Private creation now follows the same route as clicking a database in the sidebar:

1. create and refresh the database list;
2. keep the active BlockNote page open;
3. add/select the new database in the shared workspace tab rail.

The legacy standalone database screen remains only as a compatibility route for places that intentionally request it.

## Validation performed

- TypeScript syntax transpilation succeeded for `main.tsx`, `WorkspaceWorkbench.tsx`, and `DatabaseTable.tsx`.
- Full project typecheck/build could not run because the supplied archive does not contain installed npm dependencies or lockfile-backed modules.
