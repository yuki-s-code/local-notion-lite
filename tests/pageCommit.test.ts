import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommittedPageCommit, createWritingPageCommit, isCommittedPageMarker } from '../src/shared/persistence/pageCommit';

test('committed marker is accepted only when revision matches meta', () => {
  const marker = createCommittedPageCommit('page-1', '2026-06-18T10:00:00.000Z', '2026-06-18T10:00:01.000Z');
  assert.equal(isCommittedPageMarker(marker, { id: 'page-1', updatedAt: '2026-06-18T10:00:00.000Z' }, 'page-1'), true);
  assert.equal(isCommittedPageMarker(marker, { id: 'page-1', updatedAt: '2026-06-18T10:01:00.000Z' }, 'page-1'), false);
  assert.equal(isCommittedPageMarker(marker, { id: 'page-1', updatedAt: '2026-06-18T10:00:00.000Z' }, 'page-2'), false);
});

test('writing marker is never imported as a committed page', () => {
  const marker = createWritingPageCommit('page-1', '2026-06-18T10:00:00.000Z', '2026-06-18T10:00:00.100Z');
  assert.equal(isCommittedPageMarker(marker, { id: 'page-1', updatedAt: '2026-06-18T10:00:00.000Z' }, 'page-1'), false);
});
