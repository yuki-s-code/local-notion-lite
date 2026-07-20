import { createHash } from 'node:crypto';
import type { LockInfo } from '../types';

/**
 * Windows and many SMB shares are case-insensitive.  Resource IDs are NanoIDs
 * and may differ only by letter case, so the lock filename itself must not use
 * the raw ID.  A lower-case SHA-256 digest is stable and collision-resistant
 * on both case-sensitive and case-insensitive filesystems.
 */
export function editorLockFileName(kind: 'page' | 'database', id: string): string {
  const digest = createHash('sha256').update(`${kind}:${id}`, 'utf8').digest('hex');
  return `${kind}_${digest}.lock`;
}

export function editorLockResourceId(kind: 'page' | 'database', id: string): string {
  return kind === 'database' ? `database:${id}` : id;
}

/** A lock file must explicitly declare the resource it protects. */
export function lockTargetsResource(
  lock: LockInfo | null | undefined,
  kind: 'page' | 'database',
  id: string,
): boolean {
  return Boolean(lock && lock.pageId === editorLockResourceId(kind, id));
}

export function lockIsActive(lock: LockInfo | null | undefined, now = Date.now()): lock is LockInfo {
  if (!lock) return false;
  const expiresAt = Date.parse(lock.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function lockMatchesCurrentProcess(lock: LockInfo | null | undefined, appInstanceId: string): boolean {
  return Boolean(lock && lock.appInstanceId === appInstanceId);
}

export function lockBelongsToCurrentHostUser(
  lock: LockInfo | null | undefined,
  host: string,
  user: string,
): boolean {
  return Boolean(lock && lock.lockedBy === host && lock.userName === user);
}
