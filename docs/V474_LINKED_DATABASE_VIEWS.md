# v474: Linkd Database Views

## Purpose
Allow a page to reference a specific view of an existing database without duplicating rows, schema, or database storage.

## User flow
1. Edit a page and enter `/database`.
2. Select the source database for its normal embed, or select one of the displayed view chips under **リンクドビュー**.
3. The page stores a lightweight reference of the form:
   `[[database-view:<databaseId>:<viewId>|<database title> · <view title>]]`
4. The page rail and preview render that database using only the selected view.

## Safety model
- Database rows and schema remain in the source database.
- A linked view is read-only inside the page to avoid accidental changes to shared view settings.
- **DBを開く** opens the source database for intentional editing.
- Existing database embeds remain backward compatible and retain their existing editing behavior.
