import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { ItemCollection } from '../src/server/services/sharedData/itemCollection';

const normalize = (value: any) => {
  const id = String(value?.id || '').trim();
  const title = String(value?.title || '').trim();
  if (!id || !title) return null;
  return { ...value, id, title, updatedAt: String(value?.updatedAt || new Date().toISOString()) };
};

function makeCollection(root: string) {
  return new ItemCollection({
    legacyFile: path.join(root, 'legacy.json'),
    collectionKey: 'test-items',
    normalize,
    atomicWriteJson: async (file, value) => {
      await fs.ensureDir(path.dirname(file));
      await fs.writeJson(file, value, { spaces: 2 });
    },
    mutate: async (_file, task) => task(),
    limit: 100,
  });
}

test('item collection migrates legacy rows and keeps one file per item', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-item-'));
  try {
    await fs.writeJson(path.join(root, 'legacy.json'), [{ id: 'a', title: 'A', updatedAt: '2026-01-01T00:00:00.000Z' }]);
    const collection = makeCollection(root);
    const rows = await collection.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'a');
    assert.equal(await fs.pathExists(path.join(root, 'item-collections', 'test-items', 'items', 'a.json')), true);
  } finally {
    await fs.remove(root);
  }
});

test('delete tombstone prevents stale bulk data from resurrecting an item', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-item-'));
  try {
    const collection = makeCollection(root);
    await collection.upsert({ id: 'a', title: 'A' });
    await collection.delete('a');
    await collection.mergeBulk([{ id: 'a', title: 'stale A', updatedAt: '2000-01-01T00:00:00.000Z' }]);
    const rows = await collection.list();
    assert.equal(rows.length, 0);
  } finally {
    await fs.remove(root);
  }
});

test('bulk save preserves omitted items; deletion requires the explicit delete operation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-item-'));
  try {
    const collection = makeCollection(root);
    await collection.upsert({ id: 'a', title: 'A' });
    await collection.upsert({ id: 'b', title: 'B' });
    const rows = await collection.mergeBulk([{ id: 'a', title: 'A edited', updatedAt: '2999-01-01T00:00:00.000Z' }]);
    assert.deepEqual(rows.map((row) => row.id).sort(), ['a', 'b']);
  } finally {
    await fs.remove(root);
  }
});

test('delete rejects a stale revision instead of removing a newer item', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-item-'));
  try {
    const collection = makeCollection(root);
    await collection.upsert({ id: 'a', title: 'A' });
    const first = (await collection.list()).find((row) => row.id === 'a')!;
    await collection.upsert({ id: 'a', title: 'A newer', baseUpdatedAt: first.updatedAt });
    await assert.rejects(
      () => collection.delete('a', { baseUpdatedAt: first.updatedAt }),
      (error: any) => error?.code === 'ITEM_CONFLICT' && error?.statusCode === 409,
    );
    const rows = await collection.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'A newer');
  } finally {
    await fs.remove(root);
  }
});
