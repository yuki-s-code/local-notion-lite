# v412 Tag Alias Runtime Fix

## Fixed

`tagSuggestions.ts` referenced `titleAliasHits` and `bodyAliasHits` before their `const` declarations.

This caused `ReferenceError: Cannot access 'titleAliasHits' before initialization` whenever the PageInfoPanel calculated tag suggestions.

The alias list and hit counts are now initialized before the score uses them. A regression test covers alias-based suggestions.
