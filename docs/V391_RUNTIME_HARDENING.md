# V391 Runtime Hardening

## Scope

This release hardens Electron runtime boundaries without changing workspace features.

- Removed unused `chokidar` dependency.
- Made `app:ready` subscriptions disposable and aligned preload typings.
- Switched local main-process settings writes to atomic JSON writes.
- Explicitly disabled renderer Node integration and enabled web security.
- Required the ephemeral local API token for `/health`, because health responses include local path information.
- Added a CSP that permits the local API and Vite development while limiting renderer resource origins.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build` after installing dependencies.
