# v378: Private Boundary and Attachment Index

## Scope boundary

- Shared pages keep comments and attachments below the shared vault.
- Private pages keep comments below `private-pages/<pageId>/comments.json` and attachments below `private-vault/attachments/<pageId>/`.
- Legacy private-page comments and attachments created by older builds are migrated when the page data is next read. The shared copy is removed only after a successful private copy.

## Attachment index

Attachment additions now upsert the single affected row in SQLite instead of rebuilding the complete attachment index. Full rebuild remains available for repair and reindex workflows.

## Atomic writes

Temporary filenames now contain app instance, timestamp, and a random suffix to prevent same-process write collisions.
