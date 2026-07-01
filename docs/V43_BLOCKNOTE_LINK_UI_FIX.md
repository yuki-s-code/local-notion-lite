# v43 BlockNote link UI fix

- Removed the custom link tooltip that duplicated BlockNote's own link UI.
- Restored @ page-link insertion by preventing link-hover capture from intercepting suggestion clicks.
- New page links use `#local-page=<id>` instead of `local-page://<id>` so Electron does not open a separate window.
- `hashchange` is handled by the app and opens the right-side page preview.
- Existing legacy `local-page://` and `@[[title|id]]` data remains readable.
