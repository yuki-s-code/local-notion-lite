# V72 BlockNote Slash Menu Recheck

- Removed the broken custom file attachment slash implementation.
- Keeps BlockNote standard file/image/video/audio insertions via `uploadFile`.
- Uses `SuggestionMenuController` for `/` and `@`.
- `/` combines Local Notion items, Multi-Column items, and BlockNote defaults.
- If a local slash extension fails, the default BlockNote slash menu is still returned.
- Duplicate page labels are disambiguated with the page id suffix to avoid React key collisions.
