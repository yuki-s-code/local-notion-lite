# V82 Attachment Downloads

- Keeps BlockNote standard File / Image / Video / Audio insertion.
- Uploaded files are still saved under the shared vault `attachments/` folder.
- Adds an explicit download endpoint: `/pages/:id/attachments/:attachmentId/download`.
- Existing file endpoint now supports `?download=1` and sets `Content-Disposition: attachment`.
- Inline display remains available for images/videos/files through `/file`.
