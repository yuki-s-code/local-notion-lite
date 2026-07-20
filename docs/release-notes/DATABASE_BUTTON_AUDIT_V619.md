# Database Button audit (v619)

## Added
- `button` property type with explicit, row-scoped actions only.
- Supported actions: set a configured Status field to its completed option; set a configured Date field to today.
- Actions invoke the existing row PATCH path for exactly one target row/property.

## Performance and safety
- No timer, polling, background automation, global scans, or external calls were added.
- Button properties persist only their configuration; they do not write a cell value.
- Server-side row patch validation rejects attempts to patch button cells.
- Misconfigured buttons are disabled rather than guessing a target.

## Deliberately deferred
- Multi-step automation, child-task templates, notifications, and external webhooks. Those require an auditable action model and should not be added as implicit button behavior.

## Persistence fixes included during the audit
- `isDependencyRelation` is now preserved by server-side database normalization; otherwise dependency columns could lose their semantic flag after a reload.
- Status-specific Rollup functions (`count_status_done`, `count_status_open`, `percent_status_done`) are preserved by normalization; otherwise task-progress rollups could revert to an unsupported configuration after a save/reload.
