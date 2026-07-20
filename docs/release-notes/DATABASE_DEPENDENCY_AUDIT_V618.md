# v618 Database dependency audit

## Added
- A same-database `Depends On` relation can be added from Properties or supplied by the task management pack.
- A dependency means: this row should not start before the referenced rows are complete.
- Gantt shows the number of prerequisites and warns for unfinished prerequisites or dates that overlap an upstream task.

## Performance constraints
- Dependency evaluation is limited to the rows already shown by Gantt and iterates dependency edges only.
- No timers, background scans, index updates, or cross-database fan-out are added.
- Dependency relation changes use the existing row PATCH pipeline and do not introduce a separate save route.

## Deliberate scope
- This release does not automatically move dates or change Status. Automation must be explicit to avoid unexpected shared-data edits.
- It does not draw SVG dependency connectors because the current Gantt is a vertically scrolling list; connector routing would introduce layout work and visual ambiguity.
- Cross-database dependencies are not enabled. Those require server-side resolution and permissions-aware scheduling.
