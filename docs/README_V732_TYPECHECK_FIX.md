# v732 typecheck fix

Fixes TypeScript errors reported after v731:

- Replaced `import.meta.env.DEV` with a safe `(import.meta as any).env?.DEV` guard for projects without Vite env typings.
- Removed erroneous `setAllPages` calls. Page lists are derived from `tree` via `allVisiblePages`, so tree-only updates are correct.
- Wrapped `openGlossaryManager` in an event handler so the React click event is not passed as the draft term.
- Tightened row create/delete result narrowing to handle `void | null | result` return types.
- Typed the sub-item `rowById` map to avoid `unknown` row values.

Validated with esbuild syntax/transpile checks for:

- `src/renderer/src/main.tsx`
- `src/renderer/src/components/DatabaseTable.tsx`
