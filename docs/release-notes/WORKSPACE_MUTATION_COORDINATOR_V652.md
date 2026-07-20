# v652 Workspace Mutation Coordinator

- Adds a shared normalized mutation event payload for graph/cache consumers.
- Consolidates page-derived index deletion and repairs inbound page-link sources after a page is trashed or permanently removed.
- Permanently deleting a database now removes database-row indexes, graph edges and row tasks, and returns deleted row IDs for targeted semantic removal.
- This is intentionally a staged coordinator: it does not infer deletion from a missing SMB file, because that would risk data loss during partial shared-folder outages.

Package version: 2.44.0
