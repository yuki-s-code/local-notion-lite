import test from 'node:test';
import assert from 'node:assert/strict';
import {
  incrementalSemanticTargetFromQueueKey,
  normalizeIncrementalSemanticTargets,
  semanticTargetSourceKey,
} from '../src/shared/semantic/semanticTargetPolicy';

test('semantic target normalization removes invalid and duplicate targets without merging DB rows across databases', () => {
  const targets = normalizeIncrementalSemanticTargets([
    { type: 'page', sourceId: ' page-a ' },
    { type: 'page', sourceId: 'page-a' },
    { type: 'database_row', databaseId: 'db-a', sourceId: 'row-1' },
    { type: 'database_row', databaseId: 'db-b', sourceId: 'row-1' },
    { type: 'database_row', sourceId: 'missing-db' },
    { type: 'journal' as any, sourceId: 'journal-1' },
  ]);
  assert.deepEqual(targets, [
    { type: 'page', sourceId: 'page-a', databaseId: undefined },
    { type: 'database_row', databaseId: 'db-a', sourceId: 'row-1' },
    { type: 'database_row', databaseId: 'db-b', sourceId: 'row-1' },
  ]);
  assert.notEqual(semanticTargetSourceKey(targets[1]), semanticTargetSourceKey(targets[2]));
});

test('semantic queue keys parse only supported page and database-row targets', () => {
  assert.deepEqual(incrementalSemanticTargetFromQueueKey('page::page-1'), { type: 'page', sourceId: 'page-1' });
  assert.deepEqual(incrementalSemanticTargetFromQueueKey('database_row:db-1:row-1'), { type: 'database_row', databaseId: 'db-1', sourceId: 'row-1' });
  assert.equal(incrementalSemanticTargetFromQueueKey('database_row:db-only'), null);
  assert.equal(incrementalSemanticTargetFromQueueKey('page::'), null);
  assert.equal(incrementalSemanticTargetFromQueueKey('journal::2026-07-03'), null);
});

test('semantic target normalization respects the bounded incremental batch size', () => {
  const targets = normalizeIncrementalSemanticTargets(
    Array.from({ length: 30 }, (_, index) => ({ type: 'page' as const, sourceId: `p-${index}` })),
    20,
  );
  assert.equal(targets.length, 20);
  assert.equal(targets[19]?.sourceId, 'p-19');
});
