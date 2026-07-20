# V675 Architecture refactor

- Removed unused `src/renderer/src/styles.css`. `styles/app.css` is now a small entry point and imports feature-owned files. Existing visual rules remain in `legacy-core.css` during staged migration to prevent cascade regressions.
- Added focused renderer hooks for Electron bootstrap, navigation request ownership, save recovery/backoff, and startup sync.
- Added route modules for pages, Smart Assist, databases, Semantic, and Analysis. The HTTP paths and responses are unchanged.
- Added `VaultService.domains` facades for page updates, links, search, and AI. Route-facing dependencies now use named domains, allowing implementation to move from the legacy aggregate incrementally without contract changes.
- Added feature API clients (`api/pages`, `api/databases`, `api/semantic`, `api/journals`) while retaining existing `ApiClient` methods for compatibility.

## Validation

This archive has no installed dependencies or lockfile, so full Vite/TypeScript execution must be performed after `npm install` creates and commits `package-lock.json`. Static checks should verify no route groups were omitted and all imported modules exist.
