# V260 Database Preview Input Parity and Resizable Drawer

## Summary

V260 improves the database row preview drawer after adding the Notion-like row content editor.

## Changes

### 1. Preview property editing now matches table cell editing

Added:

- `src/renderer/src/components/database/DatabasePropertyEditor.tsx`

The row preview no longer uses simple generic inputs for most property types. It now uses the same interaction model as the database table rows:

- checkbox: modern check UI with immediate save
- select: dropdown using property options
- multi_select: checkbox chip list
- relation: searchable relation picker with selected items and clear action
- formula / rollup: computed read-only preview
- text / number / date: debounced input with blur commit

### 2. Row preview drawer is resizable

Updated:

- `src/renderer/src/components/database/DatabaseRowDetailDrawer.tsx`
- `src/renderer/src/components/DatabaseTable.tsx`
- `src/renderer/src/styles/app.css`
- `src/renderer/src/styles.css`

The preview drawer now has a draggable handle on the left side. Width is persisted per database using localStorage:

- key: `fast-db-preview-width:<databaseId>`

Default width: `520px`
Minimum width: `360px`
Maximum width: `920px`

### 3. Editor area made easier to edit

The row content editor area now gets more vertical space through CSS using `clamp(260px, 40vh, 620px)`.

## Not changed

- package-lock.json
- GitHub Actions
- DB schema
- API route names
- kuromoji / node-nlp

