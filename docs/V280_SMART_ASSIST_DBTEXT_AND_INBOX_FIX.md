# V280 Smart Assist dbText / Inbox quick capture fix

## Changes
- Restored `dbText` usage in `SmartAssistScreen.tsx` by importing the shared database helper after the screen split.
- Made quick capture Inbox creation always send a non-empty title from the first line of the memo.
- Hardened `/inbox` validation so missing titles are derived from text instead of returning 400.

## Non-goals
- No changes to database row preview, sidebar tree, backlink, package-lock, GitHub Actions, kuromoji, or node-nlp.
