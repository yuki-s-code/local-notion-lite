# v596.5 Electron Rebuild CLI Fix

## Fixed issue

`electron-rebuild` v3.7.x fails when the `-w` option is passed more than once:

```
argv.w.split is not a function
```

The native rebuild script now invokes Electron Rebuild once per native module:

```json
"rebuild:native": "electron-rebuild -f -w better-sqlite3 && electron-rebuild -f -w @duckdb/node-bindings"
```

This rebuilds both native modules for the Electron ABI without passing duplicate `-w` arguments.

## Build command

```bash
npm install
npm run typecheck
npm run build:win:ci
```

The `build:win:ci` script runs the DuckDB Windows packaging check, then this native rebuild step, then the Electron build and Windows portable packaging.
