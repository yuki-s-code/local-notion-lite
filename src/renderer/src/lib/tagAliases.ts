export type TagAliasMap = Record<string, string[]>;

const STORAGE_KEY = "local-notion:tag-aliases:v1";

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/^#+/, "").trim();
}

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalize(value))
    .filter((value) => value.length >= 2),
  ));
}

export function loadTagAliases(): TagAliasMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: TagAliasMap = {};
    for (const [tag, aliases] of Object.entries(parsed as Record<string, unknown>)) {
      const key = normalize(tag);
      if (!key) continue;
      const cleaned = cleanList(aliases).filter((alias) => alias !== key);
      if (cleaned.length > 0) result[key] = cleaned;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveTagAliases(next: TagAliasMap): TagAliasMap {
  const normalized: TagAliasMap = {};
  for (const [tag, aliases] of Object.entries(next)) {
    const key = normalize(tag);
    if (!key) continue;
    const cleaned = cleanList(aliases).filter((alias) => alias !== key);
    if (cleaned.length > 0) normalized[key] = cleaned;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Keep the current session usable even when browser storage is unavailable.
  }
  return normalized;
}

/**
 * Removes an alias-only tag definition from the shared/local dictionary.
 * This never changes page metadata; a tag still used by a page remains intact.
 */
export function removeTagAliasEntry(current: TagAliasMap, tag: string): TagAliasMap {
  const key = normalize(tag);
  if (!key || !(key in current)) return current;
  const next = { ...current };
  delete next[key];
  return saveTagAliases(next);
}

export function updateTagAliases(current: TagAliasMap, tag: string, input: string): TagAliasMap {
  const key = normalize(tag);
  if (!key) return current;
  const aliases = Array.from(new Set(input
    .split(/[，,\n]/)
    .map((value) => normalize(value))
    .filter((value) => value.length >= 2 && value !== key),
  ));
  const next = { ...current };
  if (aliases.length > 0) next[key] = aliases;
  else delete next[key];
  return saveTagAliases(next);
}
