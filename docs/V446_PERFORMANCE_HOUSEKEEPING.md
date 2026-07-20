# v446 Performance Housekeeping

## Included changes

1. **Process-reused Semantic SQLite connection**
   - The local `workspace-semantic-cache.sqlite` connection remains open while the server-side `SemanticIndexService` instance is alive.
   - sqlite-vec and FTS5 are initialized once per app process rather than on each related-page / Smart Assist search.
   - `dispose()` is provided for a future server shutdown or reconfiguration flow.

2. **No Smart Assist re-render for pointer activity**
   - The idle-index activity timestamp moved from React state to a ref.
   - `mousemove`, wheel, key and touch events no longer rerender the large Smart Assist screen.

3. **Safer periodic light refresh**
   - Periodic refreshes do not overlap.
   - The refresh is deferred to an idle callback where supported and is skipped while the window is not focused, hidden, or editing.

## Verification

After startup, open several related pages and check the Semantic Index card:
- `SQLite接続: 常駐（起動 1回）`
- `sqlite-vec利用回数` should rise.
- `JSフォールバック` should remain 0 in normal operation.

The shared JSON remains the source of truth. The local SQLite cache can be deleted and rebuilt.
