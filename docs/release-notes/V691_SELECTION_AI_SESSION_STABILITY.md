# V691 Selection AI Session Stability

- Treat selection AI editing as an explicit session rather than a live browser selection.
- Keep the captured Tiptap range and selection anchor while the composer is focused.
- Reposition the selection-local panel on scroll and resize; do not close it on viewport events.
- Close only through explicit close/apply flows.
