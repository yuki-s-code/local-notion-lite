# V511 — Stable BlockNote attachment references

## Purpose
BlockNote JSON must not retain the temporary `127.0.0.1:<port>` URL created by an Electron launch.

## Stored form
Attachment URLs are persisted as:

```text
local-attachment://attachment/{pageId}/{attachmentId}/{fileName}
```

No shared-folder path, network path, or Electron API port is saved in the page document.

## Runtime form
When a page opens, the renderer resolves the stable form to the current local API:

```text
http://127.0.0.1:{currentPort}/pages/{pageId}/attachments/{attachmentId}/name/{fileName}
```

The server resolves the actual file by `pageId + attachmentId` from attachment metadata. This keeps Japanese shared-folder names and filenames outside the persisted URL contract.

## Legacy pages
Existing `http://127.0.0.1:<oldPort>/pages/.../attachments/...` URLs are still read, rebased for display, and converted to stable references on the next editor save.

## Downloads
The page attachment download route now uses an explicit RFC 5987 UTF-8 `Content-Disposition` filename rather than relying on `res.download()`.
