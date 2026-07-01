import test from 'node:test';
import assert from 'node:assert/strict';
import { isSharedJsonLeaseExpired, shouldSurfaceSharedDataLock } from '../src/shared/persistence/sharedMutationPolicy';

test('shared JSON lease expires at or before now', () => {
  const now = Date.parse('2026-06-18T00:00:00.000Z');
  assert.equal(isSharedJsonLeaseExpired('2026-06-17T23:59:59.999Z', now), true);
  assert.equal(isSharedJsonLeaseExpired('2026-06-18T00:00:00.001Z', now), false);
});

test('shared data lock code is surfaced distinctly', () => {
  assert.equal(shouldSurfaceSharedDataLock('SHARED_DATA_LOCKED'), true);
  assert.equal(shouldSurfaceSharedDataLock('DATABASE_LOCKED'), false);
});
