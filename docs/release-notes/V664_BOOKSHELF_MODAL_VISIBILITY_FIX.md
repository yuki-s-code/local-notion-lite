# v664 Bookshelf delete modal visibility fix

## Cause
The bookshelf confirmation modal was created through a React Portal, but its CSS was accidentally added to `src/renderer/src/styles.css`. The renderer imports only `src/renderer/src/styles/app.css`, so the Portal DOM was rendered without fixed positioning and appeared as ordinary page content.

## Fix
The dialog styles are now defined in the imported `app.css` with a document-level overlay and an explicit top-layer `z-index`. The dialog remains mounted through `document.body`, so DockView stacking contexts cannot cover it.
