# V771 Database Row Body Autosave Fix

## Problem
Database row body editing became temporarily unresponsive whenever autosave entered the saving state.

## Root cause
Each autosave completion updated the saved content back into React state, immediately refreshed row links, and published broad workspace cache invalidations. Those operations caused expensive rerenders around the live BlockNote editor during typing.

## Changes
- Autosave waits for 1.8 seconds of typing inactivity.
- Save requests remain serialized; the latest pending document is saved after the current request.
- The saved API payload is not fed back into the active editor.
- Link refresh and workspace invalidation are coalesced and delayed by 1.2 seconds.
- Saving status remains informational and does not disable the editor.
- Latest blocks are held in a ref so the timer saves the newest draft.

## Validation
- Style checks passed for all 15 stylesheet files.
- Full TypeScript check could not run because the archive does not include node_modules/type definitions for Electron and Node.
