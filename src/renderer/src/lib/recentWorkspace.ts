export type RecentWorkspaceItem = {
  key: string;
  kind: 'page' | 'database' | 'journal';
  id: string;
  title: string;
  icon: string;
  openedAt: number;
};

const STORAGE_KEY = 'local-notion:recent-workspace-v636';
const MAX_ITEMS = 18;

function normalize(value: unknown): RecentWorkspaceItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item: any) => ({
      key: String(item?.key || ''),
      kind: item?.kind === 'database' || item?.kind === 'journal' ? item.kind : 'page',
      id: String(item?.id || ''),
      title: String(item?.title || ''),
      icon: String(item?.icon || ''),
      openedAt: Number(item?.openedAt || 0),
    }))
    .filter((item) => item.key && item.id && Number.isFinite(item.openedAt) && !seen.has(item.key) && (seen.add(item.key), true))
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, MAX_ITEMS);
}

export function readRecentWorkspaceItems(): RecentWorkspaceItem[] {
  try {
    return normalize(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function recordRecentWorkspaceItem(input: Omit<RecentWorkspaceItem, 'key' | 'openedAt'>): RecentWorkspaceItem[] {
  const kind = input.kind;
  const id = String(input.id || '').trim();
  if (!id) return readRecentWorkspaceItems();
  const next: RecentWorkspaceItem = {
    key: `${kind}:${id}`,
    kind,
    id,
    title: String(input.title || (kind === 'database' ? 'データベース' : kind === 'journal' ? 'Journal' : '無題のページ')),
    icon: String(input.icon || (kind === 'database' ? '▦' : kind === 'journal' ? '📅' : '📄')),
    openedAt: Date.now(),
  };
  const items = [next, ...readRecentWorkspaceItems().filter((item) => item.key !== next.key)].slice(0, MAX_ITEMS);
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* local UX enhancement only */ }
  return items;
}
