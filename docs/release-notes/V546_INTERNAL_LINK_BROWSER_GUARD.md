# V546 — Internal Link Browser Guard

- Electron main process now recognizes `local-page://`, `local-dbrow://`, `local-database://`, and `#local-page=`, `#local-dbrow=`, `#local-database=` links as internal resources.
- Internal BlockNote links are denied in `setWindowOpenHandler`, `will-navigate`, and the external-open IPC route.
- Only validated external HTTP(S) URLs can invoke the default browser.
