import test from 'node:test';
import assert from 'node:assert/strict';
import { lockTargetsResource, editorLockFileName, lockIsActive, lockMatchesCurrentProcess } from '../src/shared/persistence/editorLockPolicy';

test('editor lock file names preserve NanoID casing', () => {
  assert.notEqual(editorLockFileName('page', 'page_AbC123'), editorLockFileName('page', 'page_aBc123'));
  assert.match(editorLockFileName('database', 'db_A-B_1'), /^database_[a-f0-9]{64}\.lock$/);
});

test('an active lock needs a valid future expiry and matching process identity', () => {
  const lock = { pageId: 'page_A', lockedBy: 'pc', userName: 'user', appInstanceId: 'session-1', lockedAt: '2026-06-18T00:00:00.000Z', expiresAt: '2026-06-18T00:05:00.000Z' };
  assert.equal(lockIsActive(lock, Date.parse('2026-06-18T00:00:00.000Z')), true);
  assert.equal(lockIsActive(lock, Date.parse('2026-06-18T00:05:00.000Z')), false);
  assert.equal(lockMatchesCurrentProcess(lock, 'session-1'), true);
  assert.equal(lockMatchesCurrentProcess(lock, 'session-2'), false);
});


test('canonical editor lock filenames are safe on case-insensitive shares', () => {
  assert.notEqual(editorLockFileName('page', 'AbC123'), editorLockFileName('page', 'aBc123'));
  assert.match(editorLockFileName('page', 'AbC123'), /^page_[a-f0-9]{64}\.lock$/);
});

test('a lock only applies to the exact protected resource', () => {
  const lock = { pageId: 'page_A', lockedBy: 'pc', userName: 'user', appInstanceId: 'app', lockedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(lockTargetsResource(lock, 'page', 'page_A'), true);
  assert.equal(lockTargetsResource(lock, 'page', 'page_B'), false);
  assert.equal(lockTargetsResource(lock, 'database', 'page_A'), false);
});
