# V761 Google Workspace Drive integration

## Added
- Electron Main Process OAuth 2.0 Authorization Code + PKCE flow using a loopback callback.
- Drive read-only scope only.
- Access/refresh tokens remain in Main Process and are encrypted with Electron safeStorage when available.
- My Drive and shared drive search using Drive API v3 with `supportsAllDrives` and `includeItemsFromAllDrives`.
- Shared drive selector.
- Google Drive file cards on the whiteboard.
- Drive cards store file ID and web link instead of copying file bytes into the board.

## Setup
1. Create or select a Google Cloud project approved for the organization.
2. Enable Google Drive API.
3. Configure the OAuth consent screen as an internal app where organizational policy permits.
4. Create an OAuth client of type Desktop app.
5. In the whiteboard, open `Drive`, paste the client ID, save, and connect.
6. A Workspace administrator may need to mark the OAuth app as trusted in API Controls.

## Security
- No client secret is required or stored for the desktop OAuth client.
- OAuth tokens are never exposed through preload IPC to the renderer.
- The first release is read-only and does not upload, delete, or alter Drive files.
