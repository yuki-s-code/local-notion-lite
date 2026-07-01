# V417 — Shared Tag Alias Dictionary

## Objective

Move the tag alias / spelling-variation dictionary from renderer `localStorage` to the shared workspace so the same aliases are available from every PC that opens the workspace.

## Storage

- Workspace file: `workspace/tag-aliases.json`
- Format: an envelope containing `version`, `aliases`, `updatedAt`, and `updatedBy`.
- Only the normalized alias map is sent to the renderer.
- The workspace directory is created during vault initialization.

## API

- `GET /workspace/tag-aliases`
- `PUT /workspace/tag-aliases`

The PUT body is strictly validated to a bounded map of string arrays. Server-side normalization removes `#`, normalizes NFKC/case, removes aliases equal to the canonical tag, de-duplicates, and enforces size limits.

## Concurrency and write behavior

- Writes use the existing per-resource shared JSON mutation lease and atomic write path.
- Renderer input is reflected immediately in local state and localStorage.
- Shared-folder persistence is debounced by 500 ms so a textarea edit does not create one network write per keystroke.
- Before normal app termination, a pending alias write is flushed.
- `localStorage` remains only as a startup/offline fallback. If the shared dictionary is empty, existing local aliases are migrated once.

## Scope

The alias dictionary is workspace metadata. It does not change page bodies, page properties, page history, or the semantic index.

## Validation status

- TypeScript syntax/transpile check passed for all edited files.
- Full `npm run typecheck` and `npm test` could not run in the execution environment because dependency installation did not finish before the environment timeout.
