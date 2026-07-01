# V574.1 DuckDB Node API version fix

- Changed `@duckdb/node-api` from the nonexistent `^1.5.4` to the published stable version `1.5.3`.
- Pinned the exact version so that `npm install` is reproducible and does not resolve to a package version that has not been published.
- No package lockfile is included; generate it locally after installing dependencies.
