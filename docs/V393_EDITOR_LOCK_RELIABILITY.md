# v393 Editor lock reliability

## Fixed behaviour

- A read-only page banner is shown only after a lock request actually fails. It is no longer shown simply because editing is off while a page is loading or after the user exits edit mode.
- Page and database lock filenames preserve the exact resource ID casing. Legacy lowercase filenames remain readable until existing leases expire.
- New locks include a process ID and lease ID. A lock left behind by a crashed process on the same Windows account and computer is reclaimed immediately.
- Lock renewal is strict: it never recreates a missing lock and never overwrites a lease that has been replaced by another editor.

## Existing old lock files

Old locks that predate process ID support remain compatible and expire by their original five-minute TTL. They are deliberately not removed immediately because an older app instance on the same PC may still be using them.

## Shutdown repair

v392 flushed unsaved content before closing, but did not release the active editor locks. v393 releases page/database locks in the renderer shutdown handshake and repeats the cleanup in the API shutdown path. This removes the normal-restart self-lock condition.
