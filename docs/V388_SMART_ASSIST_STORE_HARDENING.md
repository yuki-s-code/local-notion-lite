# V388 Smart Assist Store Hardening

## Objective

Move the remaining shared Smart Assist operational JSON responsibilities out of `VaultService` and into `SmartAssistStore`, where they share the same mutation lock and atomic-write contract as existing model settings, item collections, and chat logs.

## Covered data

- Answer feedback (`answer-feedback.json`)
- Query normalization settings (`query-normalization.json`)
- Fallback contact settings (`fallback-contacts.json`)
- Chat-log clearing

## Behavioral changes

- Feedback bulk saves merge by item id and preserve the newest `updatedAt` record instead of blindly replacing the file.
- Bad feedback invokes the existing improvement-queue callback through the store options, keeping feedback-to-improvement automation intact.
- Query-normalization and fallback-contact seed files are created through a shared mutation lock, preventing simultaneous first-run seed writers.
- Chat-log clearing now uses the same shared mutation lock as chat-log append.

## Regression coverage

`tests/smartAssistStore.test.ts` covers newer-feedback preservation, bad-feedback queue delegation, and normalization-rule seeding/deduplication.
