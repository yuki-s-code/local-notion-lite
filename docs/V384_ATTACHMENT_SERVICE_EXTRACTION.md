# v384 Attachment Service Extraction

Attachment file I/O, privacy migration and SQLite attachment-index upserts were moved out of `VaultService` into `AttachmentService`. The public `VaultService` attachment methods remain stable facades, so renderer/API behavior is unchanged.

The next extraction candidates are comments and page history because they have similarly clear storage boundaries.
