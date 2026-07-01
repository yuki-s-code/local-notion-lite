import fs from 'fs-extra';
import path from 'node:path';
import { promises as nodeFs } from 'node:fs';
import os from 'node:os';
import { nanoid } from 'nanoid';
import { sanitizeSegment, vaultPaths } from '../../utils/paths';
import { atomicWriteJson } from '../../utils/atomicWrite';
import { withResourceMutex } from '../../utils/resourceMutex';
import { editorLockFileName, lockBelongsToCurrentHostUser, lockIsActive, lockMatchesCurrentProcess, lockTargetsResource } from '../../../shared/persistence/editorLockPolicy';
import type { LockInfo } from '../../../shared/types';

/** File-backed exclusive editor lease for one database. */
export class DatabaseLockService {
  constructor(
    private sharedRoot: string,
    private appInstanceId: string,
    private ttlMs = 5 * 60_000,
    private readonly appStartedAt = Date.now(),
  ) {}

  async acquire(databaseId: string): Promise<LockInfo> {
    const lockFile = this.lockPath(databaseId);
    return withResourceMutex(`database-editor:${lockFile}`, async () => {
      await fs.ensureDir(vaultPaths(this.sharedRoot).locks);
      const existing = await this.get(databaseId);
      if (lockMatchesCurrentProcess(existing, this.appInstanceId)) return this.extendOwnedLease(lockFile, existing!);
      if (lockIsActive(existing)) throw this.lockedError(existing);

      const lock = this.createLock(databaseId);
      try {
        await this.createExclusive(lockFile, lock);
        return lock;
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
        const winner = await this.get(databaseId);
        if (lockMatchesCurrentProcess(winner, this.appInstanceId)) return winner!;
        if (lockIsActive(winner)) throw this.lockedError(winner);
        await fs.remove(lockFile).catch(() => undefined);
        const retry = this.createLock(databaseId);
        await this.createExclusive(lockFile, retry);
        return retry;
      }
    });
  }

  async renew(databaseId: string): Promise<LockInfo> {
    const lockFile = this.lockPath(databaseId);
    return withResourceMutex(`database-editor:${lockFile}`, async () => {
      await fs.ensureDir(vaultPaths(this.sharedRoot).locks);
      const existing = await this.get(databaseId);
      if (!existing) throw new Error('Database editor lock was lost. Reopen the database to edit.');
      if (!lockMatchesCurrentProcess(existing, this.appInstanceId)) throw this.lockedError(existing);
      return this.extendOwnedLease(lockFile, existing);
    });
  }

  async release(databaseId: string): Promise<void> {
    const lockFile = this.lockPath(databaseId);
    return withResourceMutex(`database-editor:${lockFile}`, async () => {
      const lock = await this.get(databaseId);
      if (!lock || lockMatchesCurrentProcess(lock, this.appInstanceId) || !lockIsActive(lock)) {
        await fs.remove(lockFile).catch(() => undefined);
        await fs.remove(this.legacyLockPath(databaseId)).catch(() => undefined);
      }
    });
  }

  async get(databaseId: string): Promise<LockInfo | null> {
    const files = Array.from(new Set([this.lockPath(databaseId), this.legacyLockPath(databaseId)]));
    for (const file of files) {
      if (!(await fs.pathExists(file))) continue;
      const lock = await this.readLockJsonWithRetry(file);
      if (!lock) continue;
      // A filename collision must not turn another database's lease into this DB's lock.
      if (!lockTargetsResource(lock, 'database', databaseId)) continue;
      if (!lockIsActive(lock) || this.isOrphanedLocalLock(lock)) {
        await fs.remove(file).catch(() => undefined);
        continue;
      }
      return lock;
    }
    return null;
  }

  private async readLockJsonWithRetry(file: string): Promise<LockInfo | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const lock = await fs.readJson(file).catch(() => null) as LockInfo | null;
      if (lock) return lock;
      if (!(await fs.pathExists(file))) return null;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return null;
  }

  private async extendOwnedLease(file: string, existing: LockInfo): Promise<LockInfo> {
    const current = await fs.readJson(file).catch(() => null) as LockInfo | null;
    if (!current || !lockMatchesCurrentProcess(current, this.appInstanceId) || (existing.leaseId && current.leaseId && existing.leaseId !== current.leaseId)) {
      throw new Error('Database editor lock was replaced. Reopen the database to edit.');
    }
    const renewed: LockInfo = { ...current, expiresAt: new Date(Date.now() + this.ttlMs).toISOString() };
    await this.atomicWriteJson(file, renewed);
    return renewed;
  }

  private async createExclusive(file: string, lock: LockInfo): Promise<void> {
    const handle = await nodeFs.open(file, 'wx');
    try { await handle.writeFile(JSON.stringify(lock, null, 2), 'utf8'); }
    finally { await handle.close(); }
  }

  private lockedError(lock: LockInfo): Error {
    return new Error(`Database is locked by ${lock.userName} / ${lock.lockedBy}`);
  }

  private isOrphanedLocalLock(lock: LockInfo): boolean {
    if (!lockBelongsToCurrentHostUser(lock, os.hostname(), os.userInfo().username)) return false;
    // Same Electron process but an older API session: reclaim immediately.
    if (lock.appInstanceId !== this.appInstanceId && Number(lock.processId) === process.pid) return true;
    // v392 and older have no PID. Reclaim only locks from before this API
    // session; this preserves a genuinely concurrent writer if one exists.
    if (!Number.isInteger(lock.processId) || (lock.processId as number) <= 0) {
      const lockedAt = Date.parse(lock.lockedAt || '');
      return !Number.isFinite(lockedAt) || lockedAt < this.appStartedAt;
    }
    try { process.kill(lock.processId as number, 0); return false; }
    catch (error: any) { return error?.code === 'ESRCH'; }
  }

  private createLock(databaseId: string): LockInfo {
    const now = Date.now();
    return {
      pageId: `database:${databaseId}`,
      lockedBy: os.hostname(),
      userName: os.userInfo().username,
      appInstanceId: this.appInstanceId,
      processId: process.pid,
      leaseId: nanoid(12),
      lockedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    };
  }

  private lockPath(databaseId: string): string {
    return path.join(vaultPaths(this.sharedRoot).locks, editorLockFileName('database', databaseId));
  }

  private legacyLockPath(databaseId: string): string {
    return path.join(vaultPaths(this.sharedRoot).locks, `database_${sanitizeSegment(databaseId)}.lock`);
  }

  private async atomicWriteJson(file: string, data: unknown): Promise<void> {
    await atomicWriteJson(file, data, this.appInstanceId);
  }
}
