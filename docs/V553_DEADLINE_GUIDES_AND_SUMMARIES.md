# v553 Database deadline status, property guides, and summaries

## Added

- Optional `description` on each database property. It is editable from the property schema panel and shown as an input guide in table inputs, row details, and form view.
- Deadline badges for date properties whose names contain `期限`, `締切`, `期日`, `due`, or `deadline`:
  - overdue: `期限切れ N日`
  - today: `期限：今日`
  - upcoming: `期限：明日` / `あとN日`
- Dashboard summary expansion:
  - Number / Formula / Rollup: sum, average, min, max, populated row count
  - Checkbox: checked count and completion rate
  - Select: top option counts
  - Named deadline columns: overdue / today / within 7 days counts

## Compatibility

- Existing database JSON remains compatible. `description` is optional.
- No rows, cells, or property types were migrated or rewritten.
- Deadline status is opt-in by the *name* of an existing Date property, so ordinary event dates do not become deadline warnings.
