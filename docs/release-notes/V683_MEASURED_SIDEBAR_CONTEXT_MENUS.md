# V683 — Sidebar context menu measurement and extraction

- Context menus no longer use speculative fixed heights for vertical placement.
- Rendered dimensions are measured and clamped with ResizeObserver.
- Page menus now retain maxHeight in state.
- Database context menu was extracted from DatabaseSidebarTree.
- Both action lists own their scroll region.
