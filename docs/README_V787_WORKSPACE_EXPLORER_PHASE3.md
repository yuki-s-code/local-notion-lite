# V787 Workspace Explorer Phase 3

## Added
- Quick Preview panel for pages, databases, websites, images, local JSON/CSV/HTML, components, templates and themes
- Breadcrumb navigation from Web project to child resources
- Usage/reference lookup across Web Builder HTML/CSS/JavaScript and subpages
- Shared drag payload: `application/x-local-notion-workspace-item`
- Command Palette integration for Explorer and Web resources
- Responsive split layout with a sticky preview panel on desktop and stacked layout on narrow screens

## Architecture
All preview, breadcrumb, usage and drag payload logic lives in `workspace/explorerService.ts`. The Explorer screen consumes this shared service and does not create another persistent data store.

## Validation
- TypeScript transpile diagnostics: 0 for modified files
- Whole-project typecheck remains blocked only by pre-existing missing `electron` and `node` type definitions
