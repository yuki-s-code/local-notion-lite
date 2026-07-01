# v572 — Database bulk edit with safety preview

## Added
- A modern **Bulk edit** action for selected database rows.
- Supported property types: Text, Number, Select, Multi select, Date, Checkbox, URL, Phone and Email.
- Multi-select can add, remove, replace, or clear values.
- The modal shows the affected row count, a preview of the proposed change, and a required explicit confirmation.
- A post-save **Undo** toast reuses the database editor's existing snapshot history.

## Safety
- Updates are applied as one database mutation, so every selected row receives the same timestamp and the database saves as one coherent document.
- Computed fields, relation fields, automatic timestamps, rollups and formulas are intentionally excluded.
- The selected set is restricted to the rows currently selected by the user; no hidden rows are changed.
