# V256 Database Row Content Autosave Fix

## Summary

Fixes a `400 Bad Request` that could occur when autosaving the Notion-like database row content editor added in V255.

## Changes

- Made `PUT /databases/:databaseId/rows/:rowId/content` normalize its payload defensively instead of relying only on the strict zod body parser.
- Kept a markdown size guard for large payload protection.
- Made `saveDatabaseRowContent` validation more tolerant of `null`, empty, or non-string optional values.
- Prevented BlockNote's initial mount / editable-state change from triggering an unnecessary autosave.
- Added a content signature check so unchanged editor documents are not repeatedly saved.

## Why

BlockNote can emit an `onChange` event during editor initialization or editable-state changes. In V255 this could trigger an immediate autosave with editor metadata that did not always match the strict validation expectations, causing a generic HTTP 400 response.

## Not changed

- No package-lock changes.
- No GitHub Actions changes.
- No kuromoji or node-nlp changes.
- No database schema changes.
