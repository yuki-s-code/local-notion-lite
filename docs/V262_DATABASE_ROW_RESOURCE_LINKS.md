# V262 Database row resource links

## Summary

This version treats a database row content page as a page-like resource.

Implemented:

- Database rows can be inserted as `@` link candidates in BlockNote.
- Database row links are saved as `local-dbrow://<databaseId>/<rowId>` links and markdown fallback `[[dbrow:<databaseId>:<rowId>|title]]`.
- Clicking a DB row link opens the target database and selects the target row when possible.
- Database row detail now includes a Links / Child pages panel.
- A database row can create child pages from its preview drawer.
- Row content stores `childPageIds` without embedding child page content in the database file.
- Server APIs were added for row links and child page creation.

## Added APIs

```txt
GET  /databases/:databaseId/rows/:rowId/links
POST /databases/:databaseId/rows/:rowId/child-pages
```

## Design

- Relation remains structured database metadata.
- Links remain free-form references in page/body content.
- Database row body is treated as a resource: `database-row:<databaseId>:<rowId>`.
- Child pages are normal pages, while the database row body stays in `database-row-pages/`.

## Notes

This does not change GitHub Actions, package-lock, kuromoji, or node-nlp behavior.
