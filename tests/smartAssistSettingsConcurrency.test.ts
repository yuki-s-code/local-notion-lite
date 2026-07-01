import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { SmartAssistStore } from '../src/server/services/smartAssist/smartAssistStore';

async function createStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-notion-v389-'));
  const atomicWriteJson = async (file: string, value: unknown) => {
    await fs.ensureDir(path.dirname(file));
    await fs.writeJson(file, value, { spaces: 2 });
  };
  const store = new SmartAssistStore({
    sharedRoot: root,
    userLabel: () => 'test',
    atomicWriteJson,
    withSharedJsonMutation: async (_file, task) => task(),
  });
  return { root, store };
}

test('generation settings reject a stale baseUpdatedAt', async () => {
  const { root, store } = await createStore();
  try {
    const first = await store.updateGenerationSettings({ provider: 'none', enabled: false });
    const second = await store.updateGenerationSettings({ provider: 'llama-cpp', enabled: true, baseUpdatedAt: first.updatedAt });
    await assert.rejects(
      () => store.updateGenerationSettings({ provider: 'none', enabled: false, baseUpdatedAt: first.updatedAt }),
      (error: any) => error?.code === 'SETTINGS_CONFLICT',
    );
    assert.equal(second.provider, 'llama-cpp');
  } finally {
    await fs.remove(root);
  }
});

test('evaluation set uses item-level merge and preserves omitted entries', async () => {
  const { root, store } = await createStore();
  try {
    await store.saveEvaluationSet([
      { id: 'eval-a', question: 'A?', expectedFaqId: 'faq-a' },
      { id: 'eval-b', question: 'B?', expectedFaqId: 'faq-b' },
    ]);
    const after = await store.saveEvaluationSet([
      { id: 'eval-a', question: 'A updated?', expectedFaqId: 'faq-a' },
    ]);
    assert.equal(after.length, 2);
    assert.ok(after.some((entry) => entry.id === 'eval-b'));
  } finally {
    await fs.remove(root);
  }
});

test('evaluation entry delete rejects stale revision', async () => {
  const { root, store } = await createStore();
  try {
    const first = await store.upsertEvaluationEntry({ id: 'eval-x', question: 'X?', expectedFaqId: 'faq-x' });
    const entry = first.find((item) => item.id === 'eval-x')!;
    const second = await store.upsertEvaluationEntry({ ...entry, question: 'X updated?', baseUpdatedAt: entry.updatedAt });
    const changed = second.find((item) => item.id === 'eval-x')!;
    await assert.rejects(
      () => store.deleteEvaluationEntry('eval-x', entry.updatedAt),
      (error: any) => error?.code === 'ITEM_CONFLICT',
    );
    assert.ok(changed.updatedAt);
  } finally {
    await fs.remove(root);
  }
});

test('evaluation reports retain latest report plus a readable history', async () => {
  const { root, store } = await createStore();
  try {
    await store.writeEvaluationReport({ testedCount: 2, passedCount: 1, accuracy: 50, updatedAt: '2026-06-18T10:00:00.000Z' });
    await store.writeEvaluationReport({ testedCount: 3, passedCount: 3, accuracy: 100, updatedAt: '2026-06-18T11:00:00.000Z' });
    const reports = await store.listEvaluationReports();
    assert.equal(reports.length, 2);
    assert.equal(reports[0].accuracy, 100);
    assert.ok(reports[0].reportId);
  } finally {
    await fs.remove(root);
  }
});
