# v416 Tag Page Explorer

## Purpose

Turn the workspace tag dictionary into a practical navigation tool. The tag management screen now shows pages associated with the selected tag and lets users refine the result by adding more tags.

## Behavior

- Selecting a tag displays pages that carry that tag.
- `選択タグを追加` adds the currently selected tag to the explicit page filter.
- When two or more tags are selected, pages must contain **all** selected tags (AND search).
- A selected filter chip can be removed individually; `絞り込みをリセット` returns to the selected-tag view.
- Clicking a result opens that page through the existing page-navigation flow.
- The browser displays at most 60 matching pages to keep the management screen responsive.

## Data safety

This feature is renderer-only navigation. It does not write page properties, aliases, tag ranking feedback, or history.
