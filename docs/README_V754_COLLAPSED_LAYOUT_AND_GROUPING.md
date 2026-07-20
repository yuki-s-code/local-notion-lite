# V754 Collapsed Layout and Logical Grouping

## Collapsed sub-flow layout
- Collapsed frames render as compact, solid sub-flow nodes instead of transparent empty frames.
- The display width is calculated from the frame title and summary badges.
- Child count and external connection count are shown on the collapsed node.
- Connections from hidden children are projected to the collapsed frame boundary.
- Parallel proxy edges between the same projected endpoints are merged into one edge.
- Internal edges stay hidden until the frame is expanded.
- Expanding restores the original child nodes and original edge endpoints.

## Logical grouping
- Multiple selected nodes can be grouped without creating a frame.
- Clicking a grouped member selects the whole logical group.
- Dragging any grouped member moves all group members together.
- Grouped nodes can be ungrouped from the multi-selection inspector.
- Duplicating a group creates a new independent group ID instead of joining the copy to the original group.
- Group bounds are displayed as a lightweight non-interactive outline.

## Maintenance
- Grouping data is stored as `groupId` on nodes and remains independent from `parentFrameId`.
- Collapsed projection remains a display-only transformation and does not rewrite persisted node positions.
- Proxy edge metadata is transient and excluded from legacy migration requirements.
