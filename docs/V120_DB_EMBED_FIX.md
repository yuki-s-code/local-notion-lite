# V120 DB Embed Candidate Fix

- Slash menu database candidates are limited to 12 items by default.
- Use `/database name` or `/db name` to filter database candidates.
- Duplicate database titles receive a short ID suffix in the menu to avoid React key collisions.
- EmbeddedDatabasesStickyRail no longer references the App-local `tree` variable; it receives flattened pages via props.
