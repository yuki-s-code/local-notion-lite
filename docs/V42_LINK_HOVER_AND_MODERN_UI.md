# v42 Link hover tooltip and modern UI polish

## Changes

- Page links in the BlockNote body no longer open the right preview drawer immediately on click.
- Hovering a page link shows a compact Notion-like tooltip.
- The tooltip actions are: Inline, Card, and Open.
- Open displays the linked page in the right preview drawer.
- Clicking a link only opens the tooltip and prevents Electron/browser navigation.
- The link tooltip has been visually polished with a cleaner modern surface.
- No additional UI library was added in this version to avoid another dependency-resolution risk. The UI has been structured so Radix/Floating UI can be introduced later if needed.

## Design note

BlockNote content should not be modified through DOM hacks. Link presentation is still stored as BlockNote-compatible content and converted through editor commands.
