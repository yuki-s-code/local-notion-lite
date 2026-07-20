# V775.1 currentDb initialization-order fix

## Fixed

`activateWorkspaceScreen` referenced `currentDb` before the `useState` declaration for `currentDb` had executed.
This caused both TypeScript TS2448 and the runtime temporal-dead-zone error:

`Cannot access 'currentDb' before initialization`

The workspace activation and close callbacks were moved below the related page/database state declarations. No hook is conditional and the hook call order remains stable.

## Validation

- `main.tsx` TypeScript transpilation: OK
- Existing Workspace feature-tab behavior preserved
- Page/database tab ownership remains in `WorkspaceWorkbench`
