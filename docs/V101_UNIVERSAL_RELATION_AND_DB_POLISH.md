# v101 Universal Relation and Database Editor Polish

## Added

- Universal Relation foundation:
  - Database row relation
  - Page relation
  - Journal relation
- Relation properties now have a target type selector.
- Database relation properties can point to a selected database.
- Relation cells show target-specific labels.
- Row detail shows page/journal/database relation chips.

## Database editor polish

- Relation property cards have a compact target selector.
- Relation popovers were visually refined.
- The database editor keeps the lightweight custom table engine.

## Notes

This version keeps the stable v100 custom database renderer. It avoids returning to TanStack Table/Recharts because the previous user testing showed performance problems in large editable databases.
