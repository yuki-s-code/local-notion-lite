# v89 Journal Hub

v89 turns Journal into a more useful daily hub while keeping the AFFiNE-style daily note layout.

## Added

- Journal search by date, title, snippet, mood, weather, and tags.
- A right-side tab switcher:
  - Activity: pages created or updated on the selected day.
  - Review: weekly/monthly summary.
  - History: searchable journal history.
- Weekly/monthly review cards:
  - journal count
  - page update count
  - top tags
  - mood/weather summary

## Behavior

Opening a date still does not create `journal.json` by itself. The journal is saved only after writing content or editing metadata.

## Notes

This version keeps the existing v88 draft behavior and avoids adding heavy dependencies.
