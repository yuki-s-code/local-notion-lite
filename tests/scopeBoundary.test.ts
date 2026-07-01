import test from 'node:test';
import assert from 'node:assert/strict';
import { selectScopedRoot } from '../src/shared/persistence/scopeBoundary';

test('private-linked data never selects a shared storage root', () => {
  assert.equal(selectScopedRoot('private', '/shared/attachments', '/private/attachments'), '/private/attachments');
  assert.equal(selectScopedRoot('shared', '/shared/attachments', '/private/attachments'), '/shared/attachments');
  assert.equal(selectScopedRoot(undefined, '/shared/attachments', '/private/attachments'), '/shared/attachments');
});
