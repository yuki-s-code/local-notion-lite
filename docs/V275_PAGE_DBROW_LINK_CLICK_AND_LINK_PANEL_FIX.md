# V275 Page DB row link click and link panel fix

## Summary

Fixes normal page editor handling for database row links such as:

```txt
#local-dbrow=db_WkMeAq4VC3xn&row=row_1781404893271_hbnin
```

V274 inserted this URL format, but the parser treated the database id as a query key instead of the first value after `#local-dbrow=`, so the link looked valid in BlockNote's link editor but did not trigger app navigation or link-property extraction.

## Changes

- Fixed `localDatabaseRowFromHref()` in `BlockNoteEditor.tsx`.
- Supports:
  - `#local-dbrow=<databaseId>&row=<rowId>`
  - `#local-dbrow=<databaseId>:<rowId>`
  - `#local-dbrow=target=<databaseId>&row=<rowId>`
  - legacy `local-dbrow://<databaseId>/<rowId>`
  - legacy `dbrow:<databaseId>:<rowId>`
- Reads link URLs from `part.href`, `part.props.href`, or `part.props.url` to be more tolerant of BlockNote link node shapes.

## Expected behavior

- A normal page link whose URL is `#local-dbrow=...&row=...` opens the target database and row preview.
- The page property link tab detects the DB row link via markdown conversion.
- Existing database preview/sidebar/child-page behavior is unchanged.

