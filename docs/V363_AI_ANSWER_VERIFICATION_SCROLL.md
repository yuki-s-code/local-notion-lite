# V363 AI Answer Verification / Auto Scroll

## Summary

Right-bottom AI chat now adds a lightweight post-generation verification layer and improves scroll behavior after answers and action previews.

## Changes

- Adds answer verification metadata to `/semantic/chat-answer` responses.
- Checks generated answers against current page text and selected semantic source text.
- Highlights likely unsupported facts such as dates, amounts, counts, deadlines, and policy terms that are not found in the cited source text.
- Shows missing-information hints for common workflow questions such as application steps, fees, deadlines, and required documents.
- Adds an answer quality panel in the chat UI:
  - High
  - Medium
  - Needs review
- Adds warning text when generated answers include likely unsupported claims.
- Scrolls the chat message area to the latest answer, loading state, or action preview.

## Notes

This is intentionally a lightweight local verification pass. It does not replace human review, but it reduces the chance that a small local LLM appears overly confident when source evidence is incomplete.
