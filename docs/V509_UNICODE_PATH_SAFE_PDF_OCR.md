# v509 — Unicode-safe PDF / OCR execution

## What changed
External OCR tools no longer receive the original Inbox attachment path directly.
Before `pdftotext`, `pdfinfo`, `pdftoppm`, ImageMagick, or Tesseract runs, the source file is copied to an ASCII-named temporary working folder. PDF rendering output is also created there.

## Why
Some Windows builds of Poppler/Tesseract fail when a shared-folder path contains Japanese characters, symbols, or deep nested folders. The original file and its shared-folder location are not changed.

## Fallback locations
On Windows the app first tries a public, ASCII-only working location, then a system temporary location, and finally the OS temporary directory. The working directory is removed after each operation.
