import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BASE64_ATTACHMENT_BYTES,
  base64EncodedLengthForBytes,
  estimatedBase64DecodedBytes,
  isBase64AttachmentWithinLimit,
} from '../src/shared/persistence/attachmentUploadPolicy';

test('base64 upload limit accepts exactly the configured limit', () => {
  assert.equal(isBase64AttachmentWithinLimit(MAX_BASE64_ATTACHMENT_BYTES), true);
  assert.equal(isBase64AttachmentWithinLimit(MAX_BASE64_ATTACHMENT_BYTES + 1), false);
});

test('base64 length estimate is stable for common byte boundaries', () => {
  assert.equal(base64EncodedLengthForBytes(1), 4);
  assert.equal(base64EncodedLengthForBytes(2), 4);
  assert.equal(base64EncodedLengthForBytes(3), 4);
  assert.equal(base64EncodedLengthForBytes(4), 8);
  assert.equal(estimatedBase64DecodedBytes('YQ=='), 1);
  assert.equal(estimatedBase64DecodedBytes('YWI='), 2);
  assert.equal(estimatedBase64DecodedBytes('YWJj'), 3);
});
