# v72 standard BlockNote file upload

This version removes the custom `/ ファイルを添付` slash item and uses BlockNote's standard file/image/audio/video insertion flow.

## Design

- BlockNote owns the insertion UI and file block rendering.
- The app only implements `uploadFile`.
- Uploaded files are copied to the shared vault `attachments/` folder.
- BlockNote stores the returned local API URL in its standard file block.
- The server exposes a read endpoint for stored attachments.

## Why

The previous custom slash item duplicated BlockNote's built-in file support and caused menu errors. Keeping the UI inside BlockNote is more stable and consistent with BlockNote's editor model.
