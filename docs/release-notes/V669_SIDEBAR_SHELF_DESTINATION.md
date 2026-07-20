# v669 Sidebar bookshelf destination selector

The page and database sidebar context menus no longer add directly to the first/default shelf. Selecting **本棚に追加** expands the available local shelves and shows each shelf name and current item count. Selecting a destination adds the current page or database to that shelf. When no shelf exists, the user can create the local default shelf **あとで読む** and add the item in one operation.

This change only affects localStorage-backed bookshelf state. Workspace data, shared-folder data, databases, journals, and indexes are not changed.
