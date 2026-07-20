import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { CommentService } from '../src/server/services/comments/commentService';

function makeService(root: string, scope: 'shared' | 'private') {
  return new CommentService({
    getPage: (pageId) => ({
      meta: { id: pageId, title: 'Page', parentId: null, icon: '📄', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'tester', sortOrder: 0, trashed: false, properties: { tags: [], status: '未着手', assignee: '', dueDate: '', priority: 'Mid' }, scope },
      markdown: '', blocksuite: {},
    }),
    pageScope: () => scope,
    commentsPath: (pageId, selectedScope) => path.join(root, selectedScope, pageId, 'comments.json'),
    userLabel: () => 'tester',
    atomicWriteJson: async (file, value) => { await fs.ensureDir(path.dirname(file)); await fs.writeJson(file, value); },
  });
}

test('private comments migrate from the old shared path only after a private copy is written', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-comments-'));
  try {
    const legacy = path.join(root, 'shared', 'page-1', 'comments.json');
    await fs.ensureDir(path.dirname(legacy));
    await fs.writeJson(legacy, [{ id: 'c1', body: 'legacy comment', author: 'tester', createdAt: '2026-01-01T00:00:00.000Z' }]);
    const comments = await makeService(root, 'private').list('page-1');
    assert.equal(comments.length, 1);
    assert.equal(await fs.pathExists(path.join(root, 'private', 'page-1', 'comments.json')), true);
    assert.equal(await fs.pathExists(legacy), false);
  } finally {
    await fs.remove(root);
  }
});

test('comment writes are serialized and retain rapid additions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-comments-'));
  try {
    const comments = makeService(root, 'shared');
    await Promise.all([comments.add('page-1', 'first'), comments.add('page-1', 'second')]);
    const rows = await comments.list('page-1');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.body).sort(), ['first', 'second']);
  } finally {
    await fs.remove(root);
  }
});
