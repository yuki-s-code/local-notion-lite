const KEY = 'local-notion:external-source-cache-v1';
const MAX_ENTRIES = 180;

type CacheEntry<T> = { value: T; storedAt: number; expiresAt: number; accessedAt: number };
type CacheMap = Record<string, CacheEntry<unknown>>;

function read(): CacheMap {
  try { const value = JSON.parse(localStorage.getItem(KEY) || '{}'); return value && typeof value === 'object' ? value : {}; }
  catch { return {}; }
}
function write(map: CacheMap): void {
  const entries = Object.entries(map).sort((a, b) => b[1].accessedAt - a[1].accessedAt).slice(0, MAX_ENTRIES);
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
}
export function getExternalSourceCache<T>(key: string, allowStale = false): { value: T; stale: boolean } | null {
  const map = read(); const entry = map[key] as CacheEntry<T> | undefined;
  if (!entry) return null;
  const stale = entry.expiresAt <= Date.now();
  if (stale && !allowStale) return null;
  entry.accessedAt = Date.now(); write(map);
  return { value: entry.value, stale };
}
export function setExternalSourceCache<T>(key: string, value: T, ttlMs: number): void {
  const map = read(); const now = Date.now(); map[key] = { value, storedAt: now, expiresAt: now + ttlMs, accessedAt: now }; write(map);
}
export function clearExternalSourceCache(prefix?: string): void {
  if (!prefix) { localStorage.removeItem(KEY); return; }
  const map = read(); Object.keys(map).forEach((key) => { if (key.startsWith(prefix)) delete map[key]; }); write(map);
}
export function getExternalSourceCacheStats(): { count: number; bytes: number } {
  const raw = localStorage.getItem(KEY) || '{}'; return { count: Object.keys(read()).length, bytes: new Blob([raw]).size };
}
