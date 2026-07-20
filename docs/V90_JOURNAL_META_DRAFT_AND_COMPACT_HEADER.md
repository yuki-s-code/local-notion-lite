# v90 Journal meta draft and compact header

## Fixes

- Mood / weather / tags are now edited through local draft state.
- Saving no longer overwrites the focused input with stale server data while the user is typing.
- Journal auto-save still persists mood, weather, tags and BlockNote content.
- The top date/week header is more compact while keeping the current week and selected day visible.

## Behavior

Opening a journal sets a draft from the stored metadata. Editing mood, weather or tags marks the journal dirty and saves after the normal debounce. The input fields stay controlled by the draft until the user switches to another journal date.
