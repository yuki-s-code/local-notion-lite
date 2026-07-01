# v395 Lock filename integrity

- Lock filenames are SHA-256 digests of the resource kind and ID, so Windows/SMB case-insensitivity cannot collide IDs that differ only by letter case.
- A lock is considered only when its stored `pageId` matches the exact requested page or database resource.
- Older raw-ID lock files remain readable only when their embedded resource ID is exact; mismatched legacy files cannot force a page or database into read-only mode.
