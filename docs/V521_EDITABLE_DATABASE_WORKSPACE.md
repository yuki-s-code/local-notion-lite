# V521 — Editable database tabs and database BlockNote body

## Purpose
Pages and databases now use the same workspace-tab interaction:

- Sidebar click opens an item in the workspace tab strip.
- A page tab remains a normal BlockNote page editor.
- A database tab is now editable rather than a read-only preview.
- Split and compare panes intentionally remain read-only to prevent two active editors from saving the same database simultaneously.

## Database body
`WorkspaceDatabase` gains optional `descriptionBlocks`.

- Stored as `{ kind: "blocknote", blocks: [...] }` inside the same database JSON file.
- New databases receive an empty BlockNote document.
- Existing databases are normalized with an empty document on their next save.
- The database tab shows the table first, then a collapsible BlockNote body for operating rules, instructions, and notes.

## Save behaviour
- Table changes and database-body changes call the same database save API.
- The existing `baseUpdatedAt` optimistic-concurrency check is used.
- If another PC has saved a newer revision, the change is rejected and the existing conflict flow is used.

## Focus behaviour
When a database workspace tab is selected, the ordinary page toolbar and page editor are hidden. This does not hide the database body; the database's own BlockNote body remains visible directly below the table.
