# v385: CommentService / PageHistoryService

## Purpose

Moves comment persistence and page-history snapshot/diff logic out of `VaultService` without changing the public HTTP or renderer-facing APIs.

## Services

- `CommentService`
  - Page-scoped write serialization
  - Private/shared comment path selection
  - Migration of legacy private comments written under the shared page root
- `PageHistoryService`
  - Snapshot writing and listing
  - Snapshot bundle loading
  - Line diff with the existing 1,000,000-cell LCS safety limit

## Compatibility

`VaultService` remains the public facade. Existing callers continue to use `listPageComments`, `addPageComment`, `listHistory`, `diffHistory`, and restore flows unchanged.

## Tests

- Private comment migration and write serialization
- Normal history diff accounting
- Large-document diff fallback
