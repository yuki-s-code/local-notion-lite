# v598 Analysis performance optimization

- Only the selected/expanded analysis cell mounts expensive result helpers, plots, and virtual table.
- Collapsed cells retain result metadata and expose an explicit "結果を表示" action.
- ResultTable no longer scans every result row to decide whether origin navigation is possible.
- Virtual table scroll state is throttled to animation frames.
- Plot and table components are memoized.
- Run All / range / stale execution batch renderer commits and notebook persistence until the end.
