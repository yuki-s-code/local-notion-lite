# V247 API Zod Validation

## Summary

This version adds a central Zod-based request validation layer for the local Express API.

The goal is to prevent malformed request bodies and query parameters from reaching the save/update services while preserving the existing API shape used by the renderer.

## Added

- `src/server/utils/validation.ts`
  - `parseBody(req, schema)`
  - `parseQuery(req, schema)`
  - `parseItemsBody(req, itemSchema)`
  - shared `Schemas` for page, comment, attachment, inbox, Smart Assist, journal, and database routes

## Updated

- `src/server/app.ts`
  - Page create/save/move/order/comment routes now validate request bodies.
  - Attachment add/upload routes now validate body fields.
  - Inbox and task update routes now validate body shape.
  - Smart Assist chat, FAQ, synonyms, rule profiles, settings, evaluation, feedback, and query routes now validate body/query input.
  - Journal save route now validates body shape.
  - Database create/save/query/property routes now validate body/query input.

## Not changed

- No package-lock.json changes.
- No GitHub Actions changes.
- No kuromoji usage added.
- No renderer API contract changes intended.

## Notes

The schemas are intentionally permissive (`passthrough`) for complex objects such as BlockNote/Blocksuite payloads, database rows/properties/views, and Smart Assist records. This keeps compatibility while still validating the fields that commonly break persistence:

- required strings
- scope values
- numeric pagination values
- upload file/base64 fields
- list payloads supplied either as raw arrays or `{ items: [...] }`

