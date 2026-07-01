# V505 Poppler folder selection

## Purpose
Allow users to choose an extracted Poppler folder rather than locating `pdftotext` manually.

## UI
- Primary: `Popplerフォルダを選択`
- Secondary: `実行ファイルを選択`
- Reset: `自動検出に戻す`

## Detection
The selected folder is checked in this order:
1. selected folder itself
2. `bin/`
3. `Library/bin/`
4. `poppler/bin/`

A valid folder must contain all of:
- `pdftotext(.exe)`
- `pdfinfo(.exe)`
- `pdftoppm(.exe)`

Only the resolved `pdftotext` path is stored in the per-device Electron settings. The sibling tools are derived from its folder at runtime.
