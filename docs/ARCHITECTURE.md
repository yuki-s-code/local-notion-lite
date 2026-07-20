# Local Notion Lite Architecture

## Goal

A Notion-like desktop workspace that can run on each Windows PC while using an internal shared folder as the canonical storage.

## Important design decision

The shared folder is not used as a single shared SQLite database.

Instead:

- Shared folder: canonical data as page-level JSON / Markdown / attachments
- Each PC: local SQLite cache for search and fast page listing
- Locks: page-level lock files to prevent simultaneous edits of the same page

This is safer for SMB / network-drive environments than having every PC write to the same SQLite file.

## Folder layout

```txt
Z:\YourAppVault\
  pages\
    page_xxxxx\
      meta.json
      content.md
      blocksuite.json
  attachments\
  locks\
    page_xxxxx.lock
  backups\
  local-cache\
    pc-name\
      local.sqlite
  manifest.json
```

## Runtime

```txt
Electron main process
  starts local Express API on 127.0.0.1:random-port

React renderer
  calls the local API

Express API
  reads/writes shared-folder canonical files
  maintains local SQLite cache
```

## Editing model

- Different pages can be edited by different users at the same time.
- The same page is locked by one user at a time.
- Other users can view a locked page.
- Real-time Notion/Google Docs style editing is intentionally out of scope for the first MVP.

## Next engineering tasks

1. Replace the temporary Markdown textarea with a BlockNote editor component.
2. Add file watcher using chokidar to notify when shared-folder pages are updated.
3. Add page tree with parent/child sorting.
4. Add backup rotation.
5. Add conflict-copy flow if a stale lock causes a save conflict.
6. Add full database-like table view.

## v385 Service Boundaries

`CommentService` owns page-comment file persistence and privacy migration. `PageHistoryService` owns backup snapshots and bounded history diff computation. `VaultService` remains the orchestration facade so existing API routes remain stable.
