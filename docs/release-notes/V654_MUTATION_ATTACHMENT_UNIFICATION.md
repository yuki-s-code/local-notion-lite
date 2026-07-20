# v654 Mutation and Attachment Unification

- Added a renderer-wide `emitWorkspaceMutation()` emitter and expanded the typed mutation union.
- DB-row content events now include `databaseRowIds`; AI write actions and DB-row attachment uploads use the common emitter.
- Extended `attachment_index` compatibly with source identity fields for pages, Journals, and DB rows.
- New Journal/DB-row uploads are immediately indexed into the common attachment catalog while legacy page views keep working.
- Existing attachment rows are migrated lazily with page source identity.

Note: a full backfill of historical Journal/DB-row attachments is intentionally deferred to the existing derived-index rebuild action, which should be extended in a follow-up rather than making application start scan all attachments.
