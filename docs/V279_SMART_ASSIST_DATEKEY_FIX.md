# V279 Smart Assist dateKeyJst Fix

## Summary

Fixes a runtime crash when opening the Smart Assist / chatbot screen.

## Cause

`SmartAssistScreen.tsx` uses `dateKeyJst()` while building local Smart Docs, but the helper remained in `main.tsx` after the screen split and was not available in the extracted Smart Assist screen.

## Fix

Added a local `dateKeyJst()` helper to `src/renderer/src/components/screens/SmartAssistScreen.tsx`.

The helper:

- Returns an empty string for missing values.
- Formats valid dates as JST date keys using `sv-SE` format.
- Falls back to the first 10 characters for invalid date strings.
- Falls back to `toISOString().slice(0, 10)` if `Intl.DateTimeFormat` fails.

## Scope

No changes to Smart Assist search logic, database features, page links, GitHub Actions, package-lock, kuromoji, or node-nlp.
