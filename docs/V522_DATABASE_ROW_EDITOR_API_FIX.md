# V522 Database row BlockNote editor API fix

- Reverts the v521 database-level `descriptionBlocks` addition. There was no existing database-wide BlockNote body; the existing BlockNote editor belongs to each database row.
- Forwards the renderer `api` client from `WorkspaceWorkbench` to `DatabaseTable`, so `DatabaseRowContentEditor` can load and save row content in normal database tabs.
- Keeps split/compare panes read-only.
