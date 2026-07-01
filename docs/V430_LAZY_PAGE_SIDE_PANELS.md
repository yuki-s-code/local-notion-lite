# v430: Page side-panel lazy loading

## Goal
Keep page navigation responsive on Windows and shared SMB folders by separating the page body from optional side-panel data.

## Before
Opening any page immediately started all of these remote/local reads in parallel:

- attachments
- history
- conflicts
- backlinks
- comments
- activity timeline

This competed with BlockNote initialization and the delayed related-page search.

## After
- Opening a page loads only the page bundle required to render the title, properties and BlockNote body.
- Comments load when the Comments tab or toolbar button is opened.
- History, conflicts and activity load when the History tab is opened.
- Backlinks load when the Links tab is opened.
- Saving reloads only side-panel tabs that have already been opened.
- Page navigation resets the loaded-tab state, so data never leaks from the previous page.

## Data safety
This change only alters when read APIs execute. It does not change page data, history records, comment contents, backlinks, or shared-folder file formats.
