export const SHARED_JSON_LEASE_MS = 30_000;
export const SHARED_JSON_WAIT_MS = 4_000;

export function isSharedJsonLeaseExpired(expiresAt: unknown, now = Date.now()): boolean {
  const parsed = Date.parse(String(expiresAt || ''));
  return !Number.isFinite(parsed) || parsed <= now;
}

export function shouldSurfaceSharedDataLock(code: unknown): boolean {
  return String(code || '') === 'SHARED_DATA_LOCKED';
}
