# v381: Smart Assist item-level persistence

FAQ, synonyms, rule profiles, and the improvement queue now keep each record in an
individual JSON file under `smart-assist/item-collections/<collection>/items/`.

The existing aggregate JSON files are retained as compatibility caches for older
versions of the application. New writes update only the changed record and then
refresh the compatibility cache. Deletions create tombstones under
`item-collections/<collection>/tombstones/`, which stops a stale list view from
silently restoring a deleted record.

Bulk editor endpoints remain supported. They merge supplied records by ID and do
not delete records that are absent from a stale editor response. Explicit deletion
must use the existing DELETE endpoints.

## API compatibility

Existing bulk endpoints remain available for imports and JSON editor workflows.
They now merge the supplied items by ID and retain omitted records. Explicit
DELETE endpoints write tombstones, so an older/stale editor response cannot
silently restore a deleted FAQ, synonym, rule profile, or improvement item.

The improvement queue now also exposes item-level `PUT` and `DELETE` endpoints.
