# V566 — Journal attachments

## Added
- Journal-specific attachment storage under `journals/<YYYY-MM-DD>/attachments/`.
- Native file picker action for large files, avoiding the BlockNote base64 size limit.
- Drag/drop and slash-command uploads in the Journal BlockNote editor for files up to the existing safe base64 limit.
- Attachment side tab and toolbar action in the Journal screen.
- Secure localhost endpoints for list, upload, inline display and download.

## UX
- Toolbar `📎` opens the native picker.
- Right panel `📎` shows a modern list and empty-state CTA.
- Clicking an attachment opens it without leaving the Journal.

## Safety
- Attachment paths are constrained to the current journal directory.
- Uploads are serialized with the journal mutation lock.
- Deleted journals already back up the entire folder, so attached files are included in recovery backups.
