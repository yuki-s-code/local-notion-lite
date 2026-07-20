# V503 Scan PDF OCR

- Inbox PDF preview has **PDF本文を確認**. It runs local `pdftotext`; if selectable text is found, OCR is skipped and the text can be appended to Inbox.
- For scanned PDFs, choose a page and run **このページをOCR**, or explicitly confirm **全ページOCR**.
- Rendering requires Poppler binaries (`pdftotext`, `pdfinfo`, `pdftoppm`) on PATH or bundled under `resources/ocr/`. OCR uses the configured Tesseract binary.
- PDF OCR is only user-initiated. Long rendering/OCR work is done outside the shared JSON write lock; only final metadata update acquires the lock.
