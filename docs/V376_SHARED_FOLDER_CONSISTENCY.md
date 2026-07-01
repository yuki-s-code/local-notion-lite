# V376 Shared-Folder Consistency

## Goal
Prevent two PCs from both acquiring the same page/database lock and prevent an importer from reading a partially-written page bundle.

## Lock acquisition
Page and database locks now use exclusive file creation (`wx`). A competing instance reads the winning lock instead of overwriting it. Renewals still update only locks owned by the same app instance.

## Page commit marker
New page saves write `meta.json`, `content.md`, and `blocksuite.json`, then write `commit.json` last. Before a rewrite, the old `commit.json` is removed. Shared-folder import skips a page with a present-but-invalid commit marker, preserving the last local committed cache. Legacy page folders with no `commit.json` remain readable.

## Operational behavior
- A newly saved page folder includes `commit.json`.
- If a shared drive is briefly delayed mid-write, another instance keeps the last known version and imports the new revision on its next sync after `commit.json` is valid.
- This does not make power loss impossible to recover from; backups and atomic file writes still remain important.
