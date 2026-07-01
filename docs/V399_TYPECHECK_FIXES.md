# v399 Typecheck fixes

This release fixes all TypeScript errors reported by `npm run typecheck` for v398.

- External-link-card insertion now relies on the custom block schema defaults. This avoids BlockNote inferring the initial custom props as `undefined`.
- Page and database exclusive lock creation use `node:fs` promise file handles. `fs-extra.open` is typed as a file descriptor number and must not be used with `.writeFile()` / `.close()`.
- Generic item collection reads no longer use an invalid generic type predicate through `Promise.all` / `Awaited<T>`.
- Evaluation-report history is stored under the Smart Assist root (`this.p`).
- Page history metadata normalizes untrusted JSON only after an object boundary check.

Run after replacing the project files:

```bash
npm run typecheck
npm test
npm run build
```
