/**
 * Process-local FIFO mutex keyed by a shared resource path.
 *
 * Electron renderer transitions can legitimately issue overlapping acquire /
 * renew / release requests for the same resource.  The file lock remains the
 * cross-PC authority; this mutex only prevents our own API process from
 * racing its file operations and then mistaking its partially-written lease
 * for somebody else's lock.
 */
const tails = new Map<string, Promise<void>>();

export async function withResourceMutex<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  tails.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
