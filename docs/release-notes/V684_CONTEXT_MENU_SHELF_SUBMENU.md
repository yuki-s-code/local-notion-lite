# V684 Context-menu shelf submenu and safe UI extraction

- Replaced duplicated page/database in-flow bookshelf pickers with `ShelfPickerSubmenu`.
- The picker now replaces the menu action pane and provides its own bounded scroll area.
- Opening the shelf chooser no longer increases the height of the surrounding context menu.
- Existing shelf persistence and add-item functions remain unchanged.
