# v17 Inline Link Suggestions

v17 improves page links and database embeds while keeping the shared-folder-first storage design.

## Added

- When editing with BlockNote, typing `@title` shows matching page candidates.
- Matching also checks page title, page id, and page tags.
- Selecting a candidate inserts the stable marker `@[[Page Title|page_id]]`.
- Typing `/database name` or `/db name` shows matching databases.
- Selecting a database inserts the stable marker `{{database:db_id}}`.
- The manual helper search boxes remain available as a fallback.

## Current limitation

For stability, v17 inserts the selected link/embed as a new block after the current cursor block instead of rewriting the partially typed `@query` text in-place. This keeps BlockNote integration reliable and avoids depending on unstable low-level cursor APIs.

The next step is to implement a true BlockNote custom suggestion menu/custom inline schema so `@query` is replaced in-place like Notion.
