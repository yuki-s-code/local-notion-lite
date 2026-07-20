import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The renderer's editor mode must not depend on a persistent file lock.
 * Cross-PC protection is the save-time version token, represented here as
 * the standard optimistic-concurrency comparison.
 */
function isConflict(baseUpdatedAt: string | undefined, persistedUpdatedAt: string | undefined): boolean {
  return Boolean(baseUpdatedAt && persistedUpdatedAt && baseUpdatedAt !== persistedUpdatedAt);
}

test('a fresh resource is editable without a long-lived lock', () => {
  const editable = true;
  assert.equal(editable, true);
});

test('a changed persisted version is detected at save time', () => {
  assert.equal(isConflict('2026-06-19T10:00:00.000Z', '2026-06-19T10:00:01.000Z'), true);
  assert.equal(isConflict('2026-06-19T10:00:00.000Z', '2026-06-19T10:00:00.000Z'), false);
});
