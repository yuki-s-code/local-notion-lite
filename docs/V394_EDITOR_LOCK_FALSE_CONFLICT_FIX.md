# v394 Editor Lock False-Conflict Fix

## Fixed cases

- Database lock renewal no longer runs immediately after acquisition. The lock
  acquisition itself grants the first five-minute lease, so renewal begins on
  the normal 60-second schedule. This prevents two immediate renew requests
  from racing during renderer remounts.
- A lock written by an older API session in the same Electron process is
  reclaimed automatically. It cannot represent another editor.
- Legacy locks without a PID are reclaimed only when they predate the current
  API session. Active locks from another machine/user remain protected.
- Database lock acquisition/renewal reports an expected read-only result with
  HTTP 200, matching page locks. Browser consoles no longer report lock
  contention as a failed 409 network resource.

## Emergency recovery

When every user has closed Local Notion Lite and a very old version left lock
files behind, remove only `*.lock` files in `<shared root>/locks/`, then start
this version again. Never do this while another user is editing.
