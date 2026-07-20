# V343 Notion-like AI Chat Panel

## Summary

The bottom-right AI orb now opens a Notion-like AI assistant chat panel instead of the detailed Workspace AI Search screen.

## Changes

- Added `WorkspaceAiChatPanel`.
- The floating AI orb opens chat mode.
- Existing Workspace AI Search remains available as the detailed search view.
- Chat answers are grounded in Workspace Semantic Search results.
- Chat responses show source cards for FAQ, pages, DB rows, journals, and attachments.
- “詳しく検索” switches from chat mode to detailed Workspace AI Search.
- Command Palette still exposes `AI横断検索` as the detailed search entry.

## Intent

- Bottom-right orb = quick AI chat / assistant.
- Smart Assist `AI横断検索` tab = detailed cross-workspace search.
- Search results remain source-grounded and clickable.

## Notes

This version does not replace the existing FAQ chat or Smart Assist management workflows. It only changes the bottom-right orb experience to better match Notion-like AI behavior.
