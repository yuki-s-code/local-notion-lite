/**
 * Shared retry rules for renderer save queues. Kept framework-free so they can
 * be tested independently from React/Electron.
 */
export const SAVE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

export type SaveRetryPlan = {
  attempt: number;
  delayMs: number | null;
  exhausted: boolean;
};

export function getSaveRetryPlan(previousAttempts: number): SaveRetryPlan {
  const attempt = Math.max(0, Math.floor(previousAttempts)) + 1;
  const delayMs = SAVE_RETRY_DELAYS_MS[attempt - 1] ?? null;
  return {
    attempt,
    delayMs,
    exhausted: delayMs === null,
  };
}

/** HTTP status codes that normally represent a transient local/shared-folder failure. */
export function isTransientSaveFailure(status?: number): boolean {
  return status === undefined || status === 0 || status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
