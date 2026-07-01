# v453 Editor-only AI fix

The v452 editor called `/semantic/chat-answer`, so Smart Assist retrieval and source-grounding templates could produce related-page explanations instead of a rewrite.

v453 adds `/editor-ai/edit` and `VaultService.generateEditorAiEdit`. The endpoint only accepts the selected/current source text and an edit operation. It does not call semantic search, FTS5, tag lookup, page context, or Smart Assist templates.

Safety: responses that look like related-source output are rejected before they reach the editor.
