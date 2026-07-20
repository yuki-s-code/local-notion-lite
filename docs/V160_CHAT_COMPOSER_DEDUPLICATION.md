# v160 Chat Composer Deduplication

- Removed the always-visible "見つからない時" helper from the chat composer.
- Removed quick question chips from the composer because they duplicated the chat guidance flow.
- Kept the "見つからない時" suggestions only when the latest answer has weak confidence.
- Removed JSON import/export from the central composer; FAQ import/export remains available from FAQ management/library UI.
- Simplified the central composer so the primary flow is: choose answer style, ask a question, review the answer, then optionally mark it correct/improve/FAQize.
