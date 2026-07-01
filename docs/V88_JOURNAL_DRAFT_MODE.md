# V88 Journal draft mode

- Journal dates no longer create files just by being opened.
- `GET /journals/:date` returns an in-memory draft when the file does not exist.
- The journal file is written only after the user edits metadata or content and autosave runs.
- The first BlockNote mount/change event after opening a journal is ignored so opening a date does not mark it as dirty.
- Journal dots and history lists are based only on persisted `journal.json` files.

This keeps the AFFiNE-style daily note experience while avoiding empty journals being registered just by browsing dates.
