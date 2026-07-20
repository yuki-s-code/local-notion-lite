# V775 Workspace Feature Tabs

V775 adds a persistent outer feature-tab strip without replacing the existing page/database tab system.

## Ownership

- `WorkspaceWorkbench` continues to own page and database tabs, split view, comparison, pinned tabs, and recently closed tabs.
- The V775 outer strip owns only screen-level tools such as Whiteboard, Web Builder, External Sources, Analysis, Wiki, and Glossary.
- The Documents host is represented by one permanent outer tab. It does not duplicate individual page or database identifiers.

## Persistence

`local-notion:workspace-feature-tabs-v775` stores only:

- ordered screen IDs
- active screen ID
- timestamp

It does not store page IDs, database IDs, document tab state, editor state, or split state.

## Efficiency

- Maximum 12 outer feature tabs.
- Singleton screen IDs prevent duplicate tabs.
- The tab strip component is memoized.
- Existing screens remain conditionally rendered by `mainMode`; inactive heavy screens are not mounted in the background.
- No new package dependency was added.
