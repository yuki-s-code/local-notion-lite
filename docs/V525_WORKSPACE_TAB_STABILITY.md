# v525 — Workspace tab stability

## Fixed

- The database sidebar now uses the active workspace database tab as its selected state, rather than relying only on the legacy standalone database editor state.
- Database-row child pages are retained as independent workspace tabs even though they are intentionally excluded from the ordinary page tree.
- Open child-page tabs store their last known title and icon locally so tab labels remain stable while another page or database is selected.
- Closing a tab removes only that tab's cached presentation data and selects a sensible remaining tab.

## Intent

A child page under a database row is still a page. It should behave like every other page tab: opening a different tab must never close it implicitly.
