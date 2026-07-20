# V271 Database child page delete and compact tree fix

## Fixed

- Fixed the DB-row child page delete endpoint that still returned `400 Bad Request`.
- The delete flow now uses the existing `trashPage()` method instead of a non-existing `deletePage()` method.
- The route is now idempotent: stale database, row, or page references no longer break the UI with a 400 response.
- The database sidebar tree header is compacted so the database icon, shared/private badge, and title stay on one line.

## Behavior

Deleting a child page from either the DB preview or the DB sidebar tree now:

1. Removes the page id from DB-row content references.
2. Moves the page to trash if it still exists.
3. Returns success even if the tree held a stale reference.
4. Lets the renderer refresh preview/sidebar caches.

## Not changed

- package-lock.json
- GitHub Actions
- kuromoji
- node-nlp
