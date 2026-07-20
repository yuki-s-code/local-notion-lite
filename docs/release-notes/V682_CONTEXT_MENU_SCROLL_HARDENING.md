# V682 — Sidebar context-menu viewport and scroll hardening

- Added a shared viewport-position utility for fixed context menus.
- Page and database sidebar menus now receive an explicit viewport-safe maximum height.
- Long action lists scroll inside the menu while their title header remains visible.
- Page menus no longer close for every key press; only Escape closes them.
- Database sidebar menus now use the same bounded, scrollable visual treatment.
