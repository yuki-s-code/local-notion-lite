# v738 BlockSuite content preview cards

- Whiteboard page cards now lazy-load placed page markdown via the existing `api.getPage` path and render visible heading/list/quote/code/paragraph lines inside the canvas card.
- Database cards now render up to 4 meaningful properties and 5 real rows as a compact mini table instead of only a shallow overview.
- PDF cards keep the embedded preview but use a cleaner viewer URL hint.
- Preview loading is limited to placed page cards only, capped to 24 cards total and 6 concurrent loads per effect, with local component cache. No new server API or library was added.
- CSS now shows real text content instead of skeleton bars while keeping cards clipped and compact.
