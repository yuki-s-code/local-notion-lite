# v518 Database Reference Workbench

## Purpose
Database tabs now use the same BlockNote workspace tab rail as page tabs.

## Behavior
- Use the `＋` control in the BlockNote workspace tab rail to add a database.
- A database tab keeps the current BlockNote page open for editing and opens the database in a read-only reference pane.
- Split view supports page + database.
- Compare view supports page + database and database + database.
- Reference databases do not auto-save, create history, or acquire an editing lock.
- Existing database editing continues to use the normal database screen and existing save/lock path.

## Persistence
The tab layout is stored per PC under `local-notion:workspace-workbench-v518`. Existing v476 page-only tab state is migrated the first time v518 opens.
