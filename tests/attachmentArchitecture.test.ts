import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentRootForScope } from '../src/shared/persistence/scopeBoundary';
import { MAX_BASE64_ATTACHMENT_BYTES, isBase64AttachmentWithinLimit } from '../src/shared/persistence/attachmentUploadPolicy';

test('private attachment root remains isolated from shared root', () => {
  assert.equal(attachmentRootForScope('private', 'shared/attachments', 'private/attachments'), 'private/attachments');
  assert.equal(attachmentRootForScope('shared', 'shared/attachments', 'private/attachments'), 'shared/attachments');
});

test('base64 upload policy preserves 15MB boundary', () => {
  assert.equal(isBase64AttachmentWithinLimit(MAX_BASE64_ATTACHMENT_BYTES), true);
  assert.equal(isBase64AttachmentWithinLimit(MAX_BASE64_ATTACHMENT_BYTES + 1), false);
});
