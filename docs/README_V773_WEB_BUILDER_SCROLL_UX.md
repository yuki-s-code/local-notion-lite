# V773 Web Builder Scroll / UX

## Fixes
- Web Builder root now permits vertical and horizontal scrolling when the available workspace is smaller than the builder.
- Preview stage, code editor, project list, link panel, and console have independent bounded scrolling.
- The preview iframe explicitly allows scrolling.
- Responsive layouts stack editor and preview below 1180px and use a single-column layout below 760px.

## UX additions
- Collapsible project sidebar.
- Project title search.
- Collapsible console.
- Automatic preview toggle and manual refresh.
- Fullscreen preview with Escape to exit.
- Cmd/Ctrl+Enter refreshes preview.
- Cmd/Ctrl+S saves immediately.
- Tab inserts two spaces in the code editor.
- Sticky Web Builder toolbar.

## Validation
- WebBuilderScreen.tsx transpile diagnostics: 0.
