import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExternalHttpUrl } from '../src/shared/externalUrlPolicy';

test('allows http and https links intended for the default browser', () => {
  assert.equal(normalizeExternalHttpUrl('https://example.com/docs'), 'https://example.com/docs');
  assert.equal(normalizeExternalHttpUrl(' http://intranet.example.local/path '), 'http://intranet.example.local/path');
});

test('blocks file, javascript and malformed URLs', () => {
  assert.equal(normalizeExternalHttpUrl('file:///Users/test/secret.txt'), null);
  assert.equal(normalizeExternalHttpUrl('javascript:alert(1)'), null);
  assert.equal(normalizeExternalHttpUrl('not a url'), null);
});
