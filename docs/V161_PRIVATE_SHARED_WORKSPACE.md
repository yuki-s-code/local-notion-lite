# v161 Private / Shared Workspace Pack

## Purpose
Separate pages into two scopes:

- `🔒 Private`: saved under this PC's app data private vault and intended for personal notes.
- `🌐 Shared`: saved under the selected shared folder and visible to other devices/users that use the same shared root.

## What changed

1. Pages now have `meta.scope` with `private` or `shared`.
2. New root page creation offers two buttons:
   - Shared page
   - Private page
3. Child pages inherit the parent page scope by default.
4. The page toolbar has a Private / Shared switch with confirmation.
5. Sidebar page rows display a small scope badge.
6. Private page files are stored separately from the shared folder:
   - Shared: `<shared-root>/pages/<pageId>/...`
   - Private: Electron `userData/private-vault/pages/<pageId>/...`
7. Scope is also cached into SQLite via a hidden `__scope` field in `properties_json`, so lists and searches can show the correct badge without changing the SQLite schema.

## Safety rules

- Moving Private → Shared asks for confirmation because other users/devices may see the page.
- Moving Shared → Private asks for confirmation because it disappears from the shared folder.
- Existing pages default to Shared.

## Notes

This version focuses first on BlockNote page visibility and physical page storage separation. The next recommended step is to apply the same scope model to:

- Databases
- FAQ items
- Smart Assist search scope
- Attachments
- Relation safety rules, especially blocking Shared → Private references
