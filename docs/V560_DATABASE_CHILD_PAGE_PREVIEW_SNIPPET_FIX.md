# V560: Database Child-Page Preview Snippet Fix

## Fixed
- Database-row child-page sidebar previews now receive a plain-text excerpt generated from the stored page markdown.
- A child page with body text no longer incorrectly displays the empty-preview message.
- The fallback copy now appears only when the child page truly has no body text.

## Scope
- No additional API request is made while hovering.
- No shared-folder structure or page data format is changed.
