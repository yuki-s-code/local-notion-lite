# V644 Knowledge Map Interaction and Relation Layout

- Background dragging now starts from the SVG background, edges, and empty canvas areas; node handlers continue to stop propagation.
- Node locations no longer depend only on degree/ring order. Direct links and backlinks have the shortest desired distance, parent/child relations are medium distance, and shared tags are farther apart.
- A deterministic, bounded layout relaxation runs only when a graph is loaded or explicitly reset/arranged. Clicking a node never recalculates the layout.
