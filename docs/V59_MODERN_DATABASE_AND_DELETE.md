# V59 Modern Database UI and Delete

## Changes

- Polished the custom lightweight database UI without reintroducing heavy table/chart dependencies.
- Added modern database cards, soft shadows, sticky table header styling, focused cell states, and refined row preview styling.
- Added database deletion from the main database toolbar.
- Added database deletion from the database list in the sidebar.
- Deleted database JSON files are copied to `backups/deleted_database_<id>_<timestamp>/` before removal.

## Notes

The database table remains the custom lightweight virtualized implementation introduced in v58. This keeps cell input fast and avoids full table/chart recalculation on every keystroke.
