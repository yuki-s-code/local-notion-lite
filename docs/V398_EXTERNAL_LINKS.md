# v398 External HTTP(S) Links and Link Cards

## External links

- Normal `http://` and `https://` anchors in BlockNote open in the operating system default browser.
- The Electron window never navigates to the external website and does not embed it in a WebView.
- `file:`, `javascript:`, custom protocols and malformed URLs are rejected.

## External link card

Use `/外部リンクカード` (or `/URLカード`) in a BlockNote page. Enter the URL, optional title and description. The card is stored as an `externalLinkCard` block.

The card does not fetch OpenGraph metadata or remote thumbnails automatically. This preserves offline-first behavior, avoids unrequested outbound requests, and prevents a pasted URL from triggering background site access.
