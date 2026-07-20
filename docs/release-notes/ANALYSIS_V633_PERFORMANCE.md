# v633 Analysis responsiveness

- Result tables retain only page 0 plus the nearest six fetched pages; distant pages are released while scrolling large results.
- Scroll state is coalesced to one animation frame, preventing a render per native scroll event.
- The visible range fetches one page ahead/behind to reduce loading gaps at page boundaries.
- Result fetches are generation-scoped, so a late request from an older run cannot repopulate a newer result table.
- Origin navigation is memoized to keep result-table props stable during unrelated notebook updates.

This changes browser-side rendering and cache behavior only. DuckDB query semantics and stored notebook data are unchanged.
