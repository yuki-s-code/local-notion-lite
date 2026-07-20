import test from 'node:test';
import assert from 'node:assert/strict';
import { withResourceMutex } from '../src/server/utils/resourceMutex';

test('resource mutex runs overlapping operations for the same resource in FIFO order', async () => {
  const events: string[] = [];
  const first = withResourceMutex('page:alpha', async () => {
    events.push('first:start');
    await new Promise(resolve => setTimeout(resolve, 20));
    events.push('first:end');
  });
  const second = withResourceMutex('page:alpha', async () => {
    events.push('second:start');
    events.push('second:end');
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('different resources are not serialized together', async () => {
  const events: string[] = [];
  await Promise.all([
    withResourceMutex('page:a', async () => { events.push('a'); }),
    withResourceMutex('page:b', async () => { events.push('b'); }),
  ]);
  assert.deepEqual(new Set(events), new Set(['a', 'b']));
});
