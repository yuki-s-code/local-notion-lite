import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { InboxService } from '../src/server/services/inbox/inboxService';
import { JournalService } from '../src/server/services/journal/journalService';

function atomicWriteJson(file: string, value: unknown) {
  return fs.ensureDir(path.dirname(file)).then(() => fs.writeJson(file, value));
}

function serialMutation() {
  const queues = new Map<string, Promise<unknown>>();
  return async <T>(file: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(file) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    queues.set(file, run.catch(() => undefined));
    return run;
  };
}

test('InboxService serializes rapid writes and preserves both items', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-inbox-'));
  try {
    const service = new InboxService({
      sharedRoot: root,
      atomicWriteJson,
      withSharedJsonMutation: serialMutation(),
    });
    await Promise.all([
      service.create({ text: 'first capture' }),
      service.create({ text: 'second capture' }),
    ]);
    const items = await service.list();
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((item) => item.text).sort(), ['first capture', 'second capture']);
  } finally {
    await fs.remove(root);
  }
});

test('JournalService rejects stale baseUpdatedAt rather than overwriting newer content', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-journal-'));
  try {
    const service = new JournalService({
      sharedRoot: root,
      userLabel: () => 'tester',
      atomicWriteJson,
      withSharedJsonMutation: serialMutation(),
    });
    const first = await service.save({ date: '2026-06-18', markdown: 'first' });
    const second = await service.save({ date: '2026-06-18', markdown: 'second', baseUpdatedAt: first.updatedAt });
    await assert.rejects(
      () => service.save({ date: '2026-06-18', markdown: 'stale overwrite', baseUpdatedAt: first.updatedAt }),
      (error: any) => error?.code === 'JOURNAL_CONFLICT',
    );
    const current = await service.get('2026-06-18');
    assert.equal(current.markdown, 'second');
    assert.equal(current.updatedAt, second.updatedAt);
  } finally {
    await fs.remove(root);
  }
});

test('JournalService creates no file merely by opening an untouched date', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-journal-'));
  try {
    const service = new JournalService({
      sharedRoot: root,
      userLabel: () => 'tester',
      atomicWriteJson,
      withSharedJsonMutation: serialMutation(),
    });
    const draft = await service.get('2026-06-19');
    assert.equal(draft.markdown, '');
    assert.equal(await fs.pathExists(path.join(root, 'journals', '2026-06-19', 'journal.json')), false);
  } finally {
    await fs.remove(root);
  }
});

test('InboxService atomically claims an OCR job once across service instances', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-ocr-claim-'));
  try {
    const mutation = serialMutation();
    const first = new InboxService({ sharedRoot: root, atomicWriteJson, withSharedJsonMutation: mutation });
    const second = new InboxService({ sharedRoot: root, atomicWriteJson, withSharedJsonMutation: mutation });
    const item = await first.create({ text: 'OCR test' });
    await first.addAttachmentFromBase64(item.id, 'sample.png', Buffer.from('test').toString('base64'), 'image/png');
    const attachmentId = (await first.list())[0].attachments![0].id;
    // Avoid enqueue's intentional background pump: seed a queued state directly.
    await (first as any).patchAttachment(item.id, attachmentId, {
      ocrQueue: {
        status: 'queued', mode: 'inspect', preprocessing: 'standard',
        queuedAt: new Date().toISOString(), attempt: 1,
      },
    });
    const [a, b] = await Promise.all([
      (first as any).claimNextOcrJob(),
      (second as any).claimNextOcrJob(),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1);
    const stored = (await first.list())[0].attachments![0].ocrQueue;
    assert.equal(stored?.status, 'running');
    assert.ok(stored?.leaseId);
    assert.ok(stored?.workerId);
  } finally {
    await fs.remove(root);
  }
});

test('InboxService marks an expired OCR lease failed without automatic restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lnl-ocr-stale-'));
  try {
    const service = new InboxService({ sharedRoot: root, atomicWriteJson, withSharedJsonMutation: serialMutation() });
    const item = await service.create({ text: 'stale OCR test' });
    await service.addAttachmentFromBase64(item.id, 'sample.png', Buffer.from('test').toString('base64'), 'image/png');
    const attachmentId = (await service.read())[0].attachments![0].id;
    await (service as any).patchAttachment(item.id, attachmentId, {
      ocrQueue: {
        status: 'running', mode: 'all', preprocessing: 'standard', queuedAt: new Date().toISOString(),
        startedAt: new Date(Date.now() - 120_000).toISOString(), attempt: 1,
        workerId: 'other-pc', leaseId: 'expired', leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    await (service as any).recoverInterruptedOcrQueue();
    const state = (await service.read())[0].attachments![0].ocrQueue;
    assert.equal(state?.status, 'failed');
    assert.match(String(state?.error), /中断/);
    assert.equal(state?.leaseId, undefined);
  } finally {
    await fs.remove(root);
  }
});
