# v448 Background Semantic Rebuild

- Full semantic reindex can run as a server-side background job.
- Existing shared JSON remains canonical; local SQLite/vec/FTS are rebuildable caches.
- The job yields before every embedding while editor activity is active.
- Pause/resume/cancel use safe chunk boundaries, so a currently-running embedding completes first.
- The admin UI polls job state and refreshes index status after terminal state.
- Runtime-only job state intentionally does not claim crash-resume. Restarting the app cancels the in-memory job; current index stays usable.
