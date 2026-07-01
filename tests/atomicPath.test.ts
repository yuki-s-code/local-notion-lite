import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtomicTempPath } from '../src/shared/persistence/atomicPath';

test('atomic temp path is same-directory and unique per nonce', () => {
  const a = createAtomicTempPath('/vault/page/meta.json', 'app:1', 100, 'aaaaaa');
  const b = createAtomicTempPath('/vault/page/meta.json', 'app:1', 100, 'bbbbbb');
  assert.match(a, /^\/vault\/page\/meta\.json\.app_1\.100\.aaaaaa\.tmp$/);
  assert.notEqual(a, b);
});
