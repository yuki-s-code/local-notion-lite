# v72 icon sync duplication fix

This build keeps the v72 baseline and fixes page-link title synchronization so page icons do not accumulate.

## Fixed

- Page links/cards now use `page_id` as the source of truth and sync the visible title.
- Before resyncing a local page link, any previously inserted trailing `📄` icon is removed.
- Titles are normalized so `📄 📄 Title` does not accumulate when pages are renamed or new links are added.
- Existing inline links and card links continue to work.

