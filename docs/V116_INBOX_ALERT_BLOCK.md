# v116 Inbox layout fix + Alert Block Full UX

## Inbox sidebar containment

The sidebar Inbox preview now keeps long titles and memo excerpts inside the sidebar card:

- Long titles use ellipsis.
- Excerpts use ellipsis.
- The card and rows are constrained to the sidebar width.

## Alert Block with Full UX

The BlockNote editor now includes an `alert` custom block.

Supported alert types:

- Warning
- Error
- Info
- Success

Usage:

1. Type `/` in BlockNote.
2. Choose `Alert`.
3. Click the alert icon to change the alert type.
4. Select a block and use the formatting toolbar block type selector to convert it to Alert.

The implementation follows BlockNote's custom block pattern:

- `createReactBlockSpec`
- `BlockNoteSchema.create().extend({ blockSpecs: { alert } })`
- Slash menu insertion with `insertOrUpdateBlockForSlashMenu`
- Formatting toolbar block type select integration

The existing BlockNote setup remains stable:

- Multi-column blocks remain enabled.
- Standard file insertion remains enabled.
- Custom local page link suggestions remain enabled.
- The editor instance is still recreated only by pageId.
