# v729 Knowledge Cockpit UX

Added lightweight user-facing UX features:

- Home Knowledge Cockpit
- AI Activity Log backed by localStorage + CustomEvent
- Related evidence cards with relatedness wording, terms, reasons, and snippets
- Page right utility Glossary tab, mounted only when opened
- Save status animation for page autosave

Performance notes:

- Home cockpit uses existing dashboard data and localStorage activity only.
- Glossary scanning is mounted only on the glossary tab and capped to a bounded text length.
- Related evidence cards reuse existing semantic results; no extra API call is added.
- AI activity logging stores a small capped list and deduplicates near-identical events.
