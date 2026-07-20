import test from 'node:test';
import assert from 'node:assert/strict';
import { getSaveRetryPlan, isTransientSaveFailure, SAVE_RETRY_DELAYS_MS } from '../src/shared/persistence/retryPolicy';

test('save retry policy uses 2s, 5s, then 10s before exhaustion', () => {
  assert.deepEqual(SAVE_RETRY_DELAYS_MS, [2_000, 5_000, 10_000]);
  assert.deepEqual(getSaveRetryPlan(0), { attempt: 1, delayMs: 2_000, exhausted: false });
  assert.deepEqual(getSaveRetryPlan(1), { attempt: 2, delayMs: 5_000, exhausted: false });
  assert.deepEqual(getSaveRetryPlan(2), { attempt: 3, delayMs: 10_000, exhausted: false });
  assert.deepEqual(getSaveRetryPlan(3), { attempt: 4, delayMs: null, exhausted: true });
});

test('transient save failures include unavailable and server errors but not conflicts', () => {
  assert.equal(isTransientSaveFailure(503), true);
  assert.equal(isTransientSaveFailure(0), true);
  assert.equal(isTransientSaveFailure(undefined), true);
  assert.equal(isTransientSaveFailure(409), false);
  assert.equal(isTransientSaveFailure(423), false);
  assert.equal(isTransientSaveFailure(400), false);
});
