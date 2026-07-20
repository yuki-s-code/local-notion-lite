export type AiActivityKind =
  | "related"
  | "index"
  | "glossary"
  | "save"
  | "inbox"
  | "system";

export type AiActivityEntry = {
  id: string;
  kind: AiActivityKind;
  title: string;
  detail?: string;
  createdAt: number;
  targetKey?: string;
};

const STORAGE_KEY = "local-notion:ai-activity-log-v729";
const MAX_ITEMS = 36;

function safeNow(): number {
  const value = Date.now();
  return Number.isFinite(value) ? value : new Date().getTime();
}

export function readAiActivityLog(): AiActivityEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && typeof item.title === "string")
      .map((item) => ({
        id: String(item.id || `activity:${safeNow()}:${Math.random().toString(36).slice(2, 8)}`),
        kind: ["related", "index", "glossary", "save", "inbox", "system"].includes(item.kind) ? item.kind : "system",
        title: String(item.title || "AI活動"),
        detail: item.detail ? String(item.detail) : undefined,
        createdAt: Number(item.createdAt) || safeNow(),
        targetKey: item.targetKey ? String(item.targetKey) : undefined,
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function writeAiActivityLog(items: AiActivityEntry[]): AiActivityEntry[] {
  const next = items
    .filter((item) => item && item.title)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ITEMS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("local-notion:ai-activity-log-changed", { detail: { items: next } }));
  } catch {}
  return next;
}

export function recordAiActivity(input: Omit<AiActivityEntry, "id" | "createdAt"> & { createdAt?: number }): AiActivityEntry {
  const entry: AiActivityEntry = {
    id: `activity:${safeNow()}:${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    targetKey: input.targetKey,
    createdAt: input.createdAt ?? safeNow(),
  };
  const current = readAiActivityLog();
  const deduped = current.filter((item) => !(item.kind === entry.kind && item.title === entry.title && item.targetKey === entry.targetKey && entry.createdAt - item.createdAt < 20_000));
  writeAiActivityLog([entry, ...deduped]);
  return entry;
}

export function clearAiActivityLog(): void {
  writeAiActivityLog([]);
}

export function formatAiActivityTime(value: number): string {
  const diff = Math.max(0, Math.round((safeNow() - value) / 60_000));
  if (diff < 1) return "たった今";
  if (diff < 60) return `${diff}分前`;
  const hours = Math.round(diff / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.round(hours / 24);
  return `${days}日前`;
}
