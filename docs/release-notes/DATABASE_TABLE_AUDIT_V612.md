# Database table performance audit v612

## Implemented: leading-column pinning

The table now supports pinning the first one to three visible properties from the column menu.

- Pinning is a per-device display preference stored in `localStorage` (`fast-db-pinned-count:<databaseId>`).
- It does not change database schema, database rows, shared-folder files, history, Semantic Index, link index, task index, or server-side database indexes.
- The selection cell, row-number cell, and optional sub-item structure cell remain pinned as stable table controls.
- Pinned properties must be leading visible columns. The column menu offers “pin through this column,” rather than arbitrary pinning, because arbitrary sticky columns can overlap during horizontal scrolling.
- The maximum is three visible properties. This bound is intentional: every sticky column raises paint/compositing work during horizontal scrolling. Three covers common identity/status/deadline workflows without materially affecting large virtualized tables.

## Efficiency checks

- No additional rows are fetched in Server Table mode.
- No additional per-cell event listeners are introduced.
- Offset calculation is memoized from visible properties, widths, the sub-item column, and pin count.
- The virtualization window is unchanged.
- Column pinning does not call `onChange`, so it cannot create save traffic, shared sync activity, or derived-index work.

## Remaining recommended work

1. Persist compact/comfortable density as a local per-database preference.
2. Add a lightweight “scroll shadow” on the final pinned property, without scroll-state React updates.
3. Keep advanced Formula/Rollup evaluation server-side before adding heavy group summaries or chart views.
4. Introduce List view and conditional color only after their server-table behavior is explicitly defined.
