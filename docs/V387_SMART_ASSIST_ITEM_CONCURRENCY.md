# V387 Smart Assist item concurrency

V387 completes optimistic-concurrency protection for Smart Assist item deletion.

## Protected resources

- FAQ records
- Synonym entries
- Rule profiles
- Improvement queue entries

Each renderer delete request now includes the item's `updatedAt` as `baseUpdatedAt`.
The server compares it with the newest stored item before creating a tombstone.
If another PC changed the item meanwhile, deletion is rejected with:

```txt
409 ITEM_CONFLICT
```

The client keeps its local data and asks the user to reload before retrying.

## Why this matters

Without a base revision, an old list screen could delete a newly changed FAQ, synonym, rule, or queue item. The v381 item-level files and tombstones prevent resurrection; v387 prevents stale deletion of a newer item.

## Tests

`tests/itemCollection.test.ts` now verifies that a stale delete is rejected and the newer record remains intact.
