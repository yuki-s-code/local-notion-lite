import { normalizeTagKey } from './tagWorkspace';

export const TAG_GROUPS = ['業務分野', '年度', '対象者', '状態', 'その他'] as const;
export const TAG_COLORS = ['slate', 'blue', 'cyan', 'green', 'amber', 'orange', 'red', 'purple', 'pink'] as const;
export type TagGroup = typeof TAG_GROUPS[number];
export type TagColor = typeof TAG_COLORS[number];
export type TagPresentation = { group?: TagGroup; color?: TagColor };
export type TagPresentationMap = Record<string, TagPresentation>;

export function normalizeTagPresentation(input: unknown): TagPresentationMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: TagPresentationMap = {};
  for (const [rawTag, rawValue] of Object.entries(input as Record<string, unknown>).slice(0, 500)) {
    const tag = normalizeTagKey(rawTag);
    if (!tag || !rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
    const source = rawValue as Record<string, unknown>;
    const group = TAG_GROUPS.includes(source.group as TagGroup) ? source.group as TagGroup : undefined;
    const color = TAG_COLORS.includes(source.color as TagColor) ? source.color as TagColor : undefined;
    if (group || color) result[tag] = { ...(group ? { group } : {}), ...(color ? { color } : {}) };
  }
  return result;
}

export function setTagPresentation(current: TagPresentationMap, tag: string, patch: TagPresentation): TagPresentationMap {
  const key = normalizeTagKey(tag);
  if (!key) return current;
  const next = normalizeTagPresentation({ ...current, [key]: { ...current[key], ...patch } });
  if (!next[key]?.group && !next[key]?.color) delete next[key];
  return next;
}

export function tagPresentationFor(current: TagPresentationMap, tag: string): TagPresentation {
  return current[normalizeTagKey(tag)] ?? {};
}
