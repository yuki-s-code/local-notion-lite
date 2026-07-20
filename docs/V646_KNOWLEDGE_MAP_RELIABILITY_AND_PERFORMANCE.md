# V646 Knowledge map: reliability and performance

- The global graph endpoint now falls back to a page-metadata-only map if an older or partially migrated link index cannot be queried. The map remains open and displays a concise notice via zero relation count rather than failing the entire screen.
- Global map calculations avoid repeated linear node lookups for each edge.
- Pan and node dragging are batched once per animation frame, reducing React renders during pointer movement.
- In-flight map requests are versioned so a slower old response cannot overwrite a newer scope or refresh request.
