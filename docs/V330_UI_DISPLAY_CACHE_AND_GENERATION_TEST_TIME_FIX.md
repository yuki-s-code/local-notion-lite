# v330 UI Display Cache and Generation Test Time Fix

## Purpose
Improve perceived performance on company PCs without adding OpenVINO or changing the stable AI inference path.

## Changes

- Added a lightweight UI display cache table to the existing local SQLite database.
- Added `sidebar_tree_v330` cache for fast sidebar tree rendering.
- Added `recent_pages_v330` cache for future recent-page first paint optimizations.
- `/pages/tree` now checks the cached sidebar tree first and returns it immediately when the page hash is unchanged.
- Added admin endpoints:
  - `GET /ui-cache/status`
  - `POST /ui-cache/rebuild`
- Added Smart Assist settings UI buttons:
  - UI表示キャッシュ確認
  - UI表示キャッシュ再構築
- Added UI cache status panel.
- Fixed generation test elapsed display so millisecond values are not misleadingly shown as seconds.
- Reduced lightweight generation test timeout from 60 seconds to 15 seconds.

## Design

The UI display cache is not source-of-truth. Shared folder data and the normal local DB remain authoritative. The UI cache can be rebuilt at any time.

## Why this helps

The previous sidebar tree route could do heavier checks, including database-row child page exclusion and lock checks. The v330 cache makes the sidebar tree return quickly when the page list has not changed.

## Operation

Recommended first check:

1. Open Smart Assist settings.
2. Click `UI表示キャッシュ再構築`.
3. Click `UI表示キャッシュ確認`.
4. Confirm that the sidebar cache is shown as fresh.

