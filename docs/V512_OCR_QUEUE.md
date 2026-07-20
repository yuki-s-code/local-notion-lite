# V512 OCR Processing Queue (revised)

- OCR jobs are queued per Inbox attachment and executed sequentially by one local server process.
- The queue state is persisted in `inbox/items.json`; temporary PDF/image files are local only and are removed after each job.
- Claiming a job is an atomic shared-folder mutation. A claim records `workerId`, `leaseId`, heartbeat, and expiry, so two PCs cannot execute the same queued attachment.
- A stale `running` lease is marked **failed** rather than silently restarted. The user must choose **Retry**, preventing duplicate work after an unclean shutdown.
- Cancelled queued jobs stop immediately. A running job is polled for cancellation and the current external OCR process is terminated best-effort; PDF work checks cancellation between pages.
- PDF OCR persists `totalPages`, `processedPages`, and `currentPage`; the UI shows page progress while a job is active.
- The UI polls queue status every 1.8 seconds only while active work exists.
