# v396 Editor Lock Serialization

## Problem addressed

Opening the same page or database may trigger overlapping renderer requests during navigation or React remounting. The file-backed lock uses `O_EXCL`, so one request can observe a just-created but not-yet-written JSON file from another request in the same Electron API process.

## Change

- Added a process-local FIFO mutex keyed by the exact canonical lock path.
- `acquire`, `renew`, and `release` of the same page/database now run one at a time in the local API process.
- Reading a newly-created lock retries briefly before treating it as unavailable.
- File locks remain the authority between PCs; this only serializes requests within one API process.

## Operational note

A `.lock` file appearing while a resource is open is expected. It must not itself cause read-only mode; only a valid active lease owned by a different API instance may do so.
