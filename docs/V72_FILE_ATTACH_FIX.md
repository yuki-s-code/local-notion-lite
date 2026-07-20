# V72 File Attach Fix

- Fixed undefined `localFileItem` in the BlockNote slash menu.
- Added `/ ファイルを添付` slash item that calls the Electron file picker and inserts attachment blocks.
- Made page mention suggestion titles unique when duplicate page titles exist, preventing duplicate React keys in BlockNote suggestion menus.
