# v172 Better SQLite Transaction Type Fix

Fixes GitHub Actions build errors where `better-sqlite3` custom local type declarations did not include `Database.transaction()`.

## Changes

- Added `TransactionFunction` type to `src/shared/better-sqlite3.d.ts`.
- Added `Database.transaction<TArgs, TResult>()` declaration.
- No runtime logic changed.

This addresses errors like:

```txt
Property 'transaction' does not exist on type 'Database'.
```
