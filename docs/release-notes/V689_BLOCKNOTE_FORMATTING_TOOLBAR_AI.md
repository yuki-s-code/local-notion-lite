# V689 BlockNote formatting toolbar AI integration

- Removed the independent selection AI trigger bubble.
- Disabled BlockNote's default formatting toolbar and mounted an official `FormattingToolbarController`.
- Recreated the standard toolbar controls and added `✦ AI編集` as a native toolbar button.
- The editor AI panel still opens near the selected text and avoids the live `.bn-formatting-toolbar` bounds.
- No semantic, OCR, shared-folder, or background indexing work runs during text selection.
