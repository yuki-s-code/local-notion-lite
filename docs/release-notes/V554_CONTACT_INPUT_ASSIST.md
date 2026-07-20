# v554 Contact Property Input Assist

## Added
- Phone and email inputs normalize common Japanese full-width characters on blur.
- Telephone input supports digits, hyphens, parentheses and a leading plus sign.
- Email input normalizes full-width `＠` and `．`, removes whitespace, and disables capitalization/autocorrect.
- Invalid values are highlighted with a concrete Japanese error message.
- Invalid phone/email values are not committed from table/detail editors and block form submission.
- Only validated contact values become clickable `tel:` / `mailto:` links in read-only views.

## Compatibility
- Existing database values are left unchanged.
- No schema migration and no package-lock generation.
