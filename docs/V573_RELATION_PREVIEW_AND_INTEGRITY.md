# v573 Relation preview and integrity repair

## Added

- Relation candidates now show the target database name plus up to two useful target-property values.
- Selected Relation chips show the same compact preview information when it is available.
- Deleted or missing relation targets are detected while editing.
- A single action removes only the invalid references, leaving valid relations unchanged.

## Scope

- No new OCR UI was added.
- Existing same-database bidirectional relation sync, cross-database reverse-relation display, Rollup calculations, and relation restrictions are unchanged.
- The change uses existing database payloads and does not introduce a new server-side index or shared-folder file.
