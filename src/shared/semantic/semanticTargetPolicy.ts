/**
 * Shared, dependency-free rules for targeting incremental Semantic Index updates.
 * Keep this module usable from both the renderer queue and the server service.
 */
export type IncrementalSemanticTargetType = 'page' | 'database_row' | 'journal';

export type IncrementalSemanticTarget = {
  type: IncrementalSemanticTargetType;
  sourceId: string;
  databaseId?: string;
};

export function semanticTargetSourceKey(target: IncrementalSemanticTarget): string {
  return `${target.type}:${target.databaseId || ''}:${target.sourceId}`;
}

export function normalizeIncrementalSemanticTargets(
  input: ReadonlyArray<Partial<IncrementalSemanticTarget>> | null | undefined,
  limit = 100,
): IncrementalSemanticTarget[] {
  const seen = new Map<string, IncrementalSemanticTarget>();
  for (const candidate of input || []) {
    const type = candidate?.type;
    const sourceId = String(candidate?.sourceId || '').trim();
    const databaseId = String(candidate?.databaseId || '').trim() || undefined;
    if ((type !== 'page' && type !== 'database_row' && type !== 'journal') || !sourceId) continue;
    if (type === 'database_row' && !databaseId) continue;
    const target: IncrementalSemanticTarget = { type, sourceId, databaseId };
    seen.set(semanticTargetSourceKey(target), target);
    if (seen.size >= Math.max(1, Math.min(100, Math.floor(limit) || 100))) break;
  }
  return Array.from(seen.values());
}

/** Converts renderer queue keys into safe server targets. */
export function incrementalSemanticTargetFromQueueKey(
  queueKey: string,
): IncrementalSemanticTarget | null {
  const key = String(queueKey || '').trim();
  if (key.startsWith('page::')) {
    const sourceId = key.slice('page::'.length).trim();
    return sourceId ? { type: 'page', sourceId } : null;
  }
  if (key.startsWith('journal::')) {
    const sourceId = key.slice('journal::'.length).trim();
    return sourceId ? { type: 'journal', sourceId } : null;
  }
  const match = /^database_row:([^:]+):(.+)$/.exec(key);
  if (!match) return null;
  const databaseId = String(match[1] || '').trim();
  const sourceId = String(match[2] || '').trim();
  return databaseId && sourceId ? { type: 'database_row', databaseId, sourceId } : null;
}
