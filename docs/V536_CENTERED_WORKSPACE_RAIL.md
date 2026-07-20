# v536: Centered Workspace Rail

## Purpose

The tab strip and action rail were visually attached to the left edge of the editor, close to the sidebar. This version keeps the compact sticky rail at the top of the work area but centers it to the working surface.

## Layout rules

- Page tabs and commands use a centered maximum width of 1180px.
- Database tabs can expand to 1480px so dense tables retain useful horizontal space.
- The tab strip, page command row, and database command row share the same left and right boundaries.
- Negative toolbar margins are neutralized inside the workspace rail.
- On narrower windows the rail becomes full width to preserve usable touch and scroll targets.
