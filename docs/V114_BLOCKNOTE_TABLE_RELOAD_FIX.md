# v114 BlockNote table reload fix

BlockNote table blocks use structured table content. Older normalization code treated any array-like content as inline text and could save or reload malformed `table` blocks with `content: []`, which TipTap rejects with:

`Invalid content for node table: <>`

This version:

- preserves valid structured `table.content` as-is;
- never runs table content through inline text normalization;
- converts malformed legacy table blocks into a safe paragraph instead of crashing the editor;
- keeps BlockNote itself responsible for creating and editing valid table blocks.

The fix avoids touching BlockNote DOM directly and only sanitizes `initialContent` before passing it to `useCreateBlockNote`.
