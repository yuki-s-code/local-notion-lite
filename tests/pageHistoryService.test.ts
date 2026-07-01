import test from 'node:test';
import assert from 'node:assert/strict';
import { PageHistoryService } from '../src/server/services/history/pageHistoryService';

function service() {
  return new PageHistoryService({
    sharedRoot: '/tmp/local-notion-history-test',
    userLabel: () => 'tester',
    atomicWriteJson: async () => undefined,
    atomicWriteText: async () => undefined,
    normalizeMeta: (raw: any, pageId: string) => ({
      id: pageId,
      title: raw?.title || 'Untitled', parentId: null, icon: '📄',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'tester', sortOrder: 0, trashed: false,
      properties: { tags: [], status: '未着手', assignee: '', dueDate: '', priority: 'Mid' }, scope: 'shared',
    }),
    emptyBlocksuite: { version: 1, blocks: [] },
  });
}

test('history diff reports additions and removals for a small document', () => {
  const diff = service().diff('one\ntwo\nthree', 'one\nTWO\nthree\nfour');
  assert.equal(diff.addedCount, 2);
  assert.equal(diff.removedCount, 1);
  assert.deepEqual(diff.lines.map((line) => line.type), ['same', 'removed', 'added', 'same', 'added']);
});

test('history diff uses a safe summary for documents over the LCS memory threshold', () => {
  const oldText = Array.from({ length: 1001 }, (_, index) => `old ${index}`).join('\n');
  const newText = Array.from({ length: 1001 }, (_, index) => `new ${index}`).join('\n');
  const diff = service().diff(oldText, newText);
  assert.equal(diff.lines.length, 1);
  assert.match(diff.lines[0].text, /詳細な行単位比較を省略/);
  assert.equal(diff.addedCount, 0);
  assert.equal(diff.removedCount, 0);
});


// v414 regression note: tag-only history classification is verified through VaultService integration.
