# V648 Knowledge Map — clusters, visual priority, direct organization

- Clusters are computed client-side only from the bounded visible graph (max 320 nodes), with no workspace body, OCR, or embedding scan.
- Direct/hierarchy edges build durable clusters; only small tag groups may merge clusters to avoid a generic tag joining the whole map.
- Node significance is derived from current visible degree and updated_at metadata: hubs, recent items, stale hubs, and isolated items.
- Direct organization reuses the existing `PATCH /pages/:id/move` route. It only permits moving a page under another selected page and requires confirmation.
