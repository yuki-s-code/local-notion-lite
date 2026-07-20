# v96.1 Board View group property fix

- Added missing `getBoardGroupProperty()`.
- Board View now safely selects a group property in this order: select, checkbox, text, first property.
- Creating a Board View no longer throws `getBoardGroupProperty is not defined`.
