# V390 Evaluation Operations

- Evaluation entries can be created, edited, and deleted individually from the AI data screen.
- Updates and deletes use `updatedAt` as optimistic concurrency control; stale operations receive `ITEM_CONFLICT`.
- Each evaluation run writes the latest report and a dated history entry. The latest 30 reports are retained.
- Each failed evaluation remains linked to the improvement queue through the existing `evaluation-mismatch` path.
