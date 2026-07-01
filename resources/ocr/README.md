# Local OCR runtime

Local Notion Lite uses the Tesseract executable only when the user starts OCR from an Inbox image.

For Windows packaging, place `tesseract.exe` and the required `tessdata/jpn.traineddata` and `tessdata/eng.traineddata` below this directory before packaging:

```text
resources/ocr/
  tesseract.exe
  tessdata/
    jpn.traineddata
    eng.traineddata
```

At runtime the application first uses `resources/ocr/tesseract.exe`, then falls back to a `tesseract` command available on PATH. OCR is never started automatically.
