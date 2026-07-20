# v727 Minimap short-page layout fix

- Removed fixed 上/中/下 ruler labels from the minimap. VS Code does not split short files into top/middle/bottom zones.
- Removed the repeating horizontal grid background that made short pages look artificially divided.
- Changed canvas y-positioning so short pages are packed from the top using natural line pitch instead of spreading lines across the full minimap height.
- Long pages still compress to the full minimap height when natural line pitch would overflow.
- Hide the glass viewport overlay when the page is not actually scrollable, so short pages are not covered by a full-height current-position bar.
