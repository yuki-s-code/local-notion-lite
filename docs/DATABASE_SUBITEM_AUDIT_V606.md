# Database sub-items (v606)

Implemented a Notion-like sub-item model using an explicit self-relation property marked `isSubItemRelation`.

- The schema panel can add exactly one **親アイテム** property.
- Each row accepts at most one parent.
- Table view groups visible filtered rows into a parent/child hierarchy while preserving every row if a relation cycle or hidden parent exists.
- Server Table paging is intentionally disabled only when sub-items are active, because hierarchy requires the complete filtered set. Existing large DB tables without sub-items retain server paging.
- The property is normalized on the server and persists in the existing DB JSON format; it does not create a separate index or affect semantic/link indexes.

Follow-up: parent progress rollups, collapsed children persisted per view, dependency arrows in Gantt.
