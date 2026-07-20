# V283 Smart Assist modelId type fix

## Summary
Fixed a TypeScript error in `vaultService.ts` where `settings.modelId` could be `undefined` but was passed to helpers that require `string`.

## Changes
- Added fallback to `DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID` in `checkSmartAssistTransformerModel()`.
- Added the same fallback in `downloadSmartAssistTransformerModel()`.
- Passed the resolved `modelId` to `getTransformerRuntimeInfo()` and Hugging Face URL generation.

## Scope
No UI, database, sidebar, page-link, or GitHub Actions changes.
