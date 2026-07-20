# V417.1: Zod record validation startup fix

## Cause

`z.record(...)` returns `ZodRecord`, which does not implement `.max()` in Zod 3.
Calling `.max(500)` during schema creation caused the Electron main process to throw before startup.

## Fix

The workspace tag-alias schema now:

- limits each tag's alias array to 80 values;
- limits each alias to 200 characters;
- limits the number of tag keys to 500 through `superRefine` and `Object.keys(aliases).length`.

This preserves the intended input limits without calling unsupported `ZodRecord.max()`.
