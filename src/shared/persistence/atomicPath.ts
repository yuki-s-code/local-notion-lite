/** Build a same-directory temporary filename suitable for atomic replacement. */
export function createAtomicTempPath(file: string, instanceId: string, now: number, nonce: string): string {
  const safeInstance = String(instanceId || 'process').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeNonce = String(nonce || 'tmp').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${file}.${safeInstance}.${Math.max(0, Math.floor(now))}.${safeNonce}.tmp`;
}
