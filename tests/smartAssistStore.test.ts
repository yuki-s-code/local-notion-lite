import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { SmartAssistStore } from '../src/server/services/smartAssist/smartAssistStore';

function makeStore(root: string, onBadFeedback?: (item: any) => Promise<void>) {
  return new SmartAssistStore({
    sharedRoot: root,
    userLabel: () => 'test-user',
    atomicWriteJson: async (file, value) => {
      await fs.ensureDir(path.dirname(file));
      const tmp = `${file}.test.tmp`;
      await fs.writeJson(tmp, value, { spaces: 2 });
      await fs.move(tmp, file, { overwrite: true });
    },
    mutate: async (_file, task) => task(),
    onBadFeedback,
  });
}

test('feedback save preserves a newer entry already written by another client', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-smart-store-'));
  try {
    const store = makeStore(root);
    await store.saveFeedback([{ id: 'feedback-a', question: '質問', rating: 'good', updatedAt: '2026-01-02T00:00:00.000Z' }]);
    const saved = await store.saveFeedback([{ id: 'feedback-a', question: '古い質問', rating: 'bad', updatedAt: '2026-01-01T00:00:00.000Z' }]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].question, '質問');
    assert.equal(saved[0].rating, 'good');
  } finally {
    await fs.remove(root);
  }
});

test('bad feedback invokes the improvement-queue callback once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-smart-store-'));
  const received: any[] = [];
  try {
    const store = makeStore(root, async (item) => { received.push(item); });
    const feedback = await store.addFeedback({ question: '回答が違います', rating: 'bad' });
    assert.equal(feedback.length, 1);
    assert.equal(received.length, 1);
    assert.equal(received[0].question, '回答が違います');
  } finally {
    await fs.remove(root);
  }
});

test('query normalization seeds once and saves normalized unique rules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-smart-store-'));
  try {
    const store = makeStore(root);
    const seeded = await store.listQueryNormalizationRules();
    assert.ok(Array.isArray(seeded.rules));
    const saved = await store.saveQueryNormalizationRules({
      rules: [
        { from: ' 学童 ', to: ' 放課後児童クラブ ' },
        { from: '学童', to: '放課後児童クラブ' },
        { from: '有休', to: '有給休暇' },
      ],
    });
    assert.deepEqual(saved.rules, [
      { from: '学童', to: '放課後児童クラブ' },
      { from: '有休', to: '有給休暇' },
    ]);
  } finally {
    await fs.remove(root);
  }
});
