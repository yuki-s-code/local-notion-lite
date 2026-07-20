# v728 DB Table UX / Sub-item Fix

## Fixed

1. **Debounced cell edits are flushed on unmount**
   - Virtual scrolling can unmount a row before the 700ms debounce fires.
   - `FastCell` and `DatabasePropertyEditor` now keep a pending value ref and flush it during cleanup.
   - This prevents losing an edit when the user types and immediately scrolls.

2. **Relation picker is rendered through a viewport portal**
   - Relation menus no longer expand the table row height or get clipped by the virtual scroll container.
   - The picker is click-controlled and positioned from the trigger button's `getBoundingClientRect()`.

3. **Sub-item relation and Server Table behavior is explicit**
   - Parent/child hierarchy requires the full filtered row set to calculate descendants and collapse state.
   - When a sub-item relation exists, Server Table is disabled in the toolbar and a note explains why.
   - This avoids the confusing state where parent relation exists but collapse cannot be calculated correctly from one server page.

4. **Fixed virtual row height is stabilized**
   - Virtual row height now matches CSS more closely: comfortable 52px / compact 42px.
   - Relation menus are portaled, multi-select chips are clipped to one row in the table, and contact errors are overlaid without growing rows.
   - This reduces row overlap and scroll-position drift under virtual scrolling.

## Validation

- `node scripts/check-styles.mjs` OK
- esbuild syntax checks OK:
  - `DatabaseTable.tsx`
  - `DatabaseRows.tsx`
  - `DatabasePropertyEditor.tsx`
  - `DatabaseToolbar.tsx`
- `src/**/*.js` count: 0
