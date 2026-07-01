import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationCoordinator } from '../src/renderer/src/lib/navigationCoordinator';
import { flushQueuedSave } from '../src/renderer/src/lib/saveCoordinator';

test('primary navigation and link preview have independent request sequences', () => {
  const coordinator = new NavigationCoordinator();
  const primary = coordinator.beginPrimary();
  const preview = coordinator.beginPreview();

  assert.equal(coordinator.isPrimaryCurrent(primary), true);
  assert.equal(coordinator.isPreviewCurrent(preview), true);

  coordinator.beginPreview();
  assert.equal(coordinator.isPrimaryCurrent(primary), true);
  assert.equal(coordinator.isPreviewCurrent(preview), false);

  coordinator.invalidatePrimary();
  assert.equal(coordinator.isPrimaryCurrent(primary), false);
});

test('flushQueuedSave does not touch an idle save pipeline', async () => {
  let requested = 0;
  await flushQueuedSave({
    shouldFlush: false,
    requestSave: async () => { requested += 1; },
    getDrain: () => null,
  });
  assert.equal(requested, 0);
});

test('flushQueuedSave requests a save then waits for the active drain', async () => {
  const events: string[] = [];
  let resolveDrain: (() => void) | undefined;
  const drain = new Promise<void>((resolve) => { resolveDrain = resolve; });
  const flushing = flushQueuedSave({
    shouldFlush: true,
    requestSave: async () => { events.push('request'); },
    getDrain: () => drain,
  });
  await Promise.resolve();
  assert.deepEqual(events, ['request']);
  events.push('draining');
  resolveDrain?.();
  await flushing;
  assert.deepEqual(events, ['request', 'draining']);
});
