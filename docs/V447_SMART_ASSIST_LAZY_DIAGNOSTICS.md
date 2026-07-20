# v447 Smart Assist: lazy diagnostic computation

## Purpose
Reduce renderer CPU work while users are typing or chatting.

## Changes
- Current-page markdown is passed into the local fallback corpus through `useDeferredValue`, so editor keystrokes do not synchronously rebuild Smart Assist token indexes.
- The Details modal is the only consumer of local full-corpus document filters, search ranking, selected-document diagnostics, token extraction and all-pairs relation suggestions. Those calculations now run only while the modal is open.
- Workspace AI, FAQ server retrieval, sqlite-vec and FTS5 behavior are unchanged. Local fallback remains available.

## Expected effect
The change removes avoidable O(n) and O(n²)-like diagnostic work from ordinary chat/page-edit renders. It does not alter shared JSON, semantic cache, vector cache, or ranking rules.
