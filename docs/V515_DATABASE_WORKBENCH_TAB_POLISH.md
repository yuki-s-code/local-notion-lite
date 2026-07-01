# V515 — Database Workbench Tab Polish

## What changed

- Rebuilt database tabs so long database, view, and row titles cannot expand or break the tab strip.
- Every tab has a bounded responsive width (`168px`–`310px`), `min-width: 0`, and two independently ellipsized lines.
- The primary label now identifies the open resource; the compact second line identifies its database / role.
- Pin and close actions are visually quiet until the tab is active or hovered, preventing clutter.
- Replaced the invalid container `role="tab"` pattern with a real tab button and separate action controls.
- Fixed the active-tab key calculation for database views. Previously a selected view could be saved under its view ID but compared against `source`, causing the active state to fail.
- Preserves v514 local tab history by migrating it on the first v515 load.

## Behaviour

- Source database: `DB title` / `データベース`
- Saved view: `View title` / `DB title`
- Row detail: `Row title` / `DB title · 行の詳細`

The full name remains available through the native hover tooltip, while layout remains stable even with very long Japanese titles.
