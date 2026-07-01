# V582 – Jupyter-like Analysis Workbench

## Added cell types
- **Section**: Heading, description and collapsible groups. The left outline jumps to each section.
- **Variable**: Safe notebook-scoped scalar usable as `{{variable_name}}`, alongside existing typed parameter cells.
- **Analysis function**: Curated DataFrame transformations: period-over-period change, moving average, cumulative total, share of total, rank, fill-forward and 3-sigma outlier exclusion. Arbitrary JavaScript/Python is intentionally not executed.
- **Import**: CSV, Excel (`.xlsx` / `.xls`) and JSON import to a local notebook cell. Imports are capped at 10,000 rows and stored only in the local analysis notebook JSON, never written to shared workspace data.

## Execution controls
- Run selected cell (existing)
- Run through selected cell
- Run from selected cell onward
- Run stale cells only
- Run all

Dependencies still resolve only to upper cells and auto-run as required.

## Snapshots
Each result cell can save up to 8 local snapshots. A snapshot stores the execution metadata plus a 1,000-row sample, and is retained in `local.sqlite` as notebook metadata.

## Presentation mode
Presentation mode hides editor controls, sidebars and implementation details. Browser/Electron print output uses the same presentation-oriented layout.
