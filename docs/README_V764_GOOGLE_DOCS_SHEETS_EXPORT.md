# V764 Google Docs / Sheets Export

## Added
- Google Docs API write integration
- Google Sheets API write integration
- Export selected whiteboard nodes, or the whole board when nothing is selected
- Docs export includes node type, title, body and external link
- Sheets export includes type, title, body, URL, position, size, group and frame identifiers
- Renderer never receives OAuth access tokens
- Google API writes remain in Electron main process
- Plugin Engine registration: `integration.google-export`

## OAuth scopes
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/spreadsheets`

Existing users must disconnect and reconnect once to grant the additional scopes.
