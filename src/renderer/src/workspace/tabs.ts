import { createVersionedJsonStore } from "./storage";
import { getWorkspaceScreen } from "./registry";
import type { WorkspaceScreenId } from "./types";

export type WorkspaceTabsState = {
  version: 1;
  openScreens: WorkspaceScreenId[];
  activeScreen: WorkspaceScreenId;
  updatedAt: number;
};

const FALLBACK: WorkspaceTabsState = {
  version: 1,
  openScreens: ["documents"],
  activeScreen: "documents",
  updatedAt: Date.now(),
};

function sanitizeScreens(value: unknown): WorkspaceScreenId[] {
  if (!Array.isArray(value)) return FALLBACK.openScreens;
  const seen = new Set<WorkspaceScreenId>();
  const result: WorkspaceScreenId[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const definition = getWorkspaceScreen(item as WorkspaceScreenId);
    if (definition.id !== item || definition.tabOwnership === "none" || seen.has(definition.id)) continue;
    seen.add(definition.id);
    result.push(definition.id);
  }
  return result.length > 0 ? result.slice(0, 12) : FALLBACK.openScreens;
}

export const workspaceTabsStore = createVersionedJsonStore<WorkspaceTabsState>({
  key: "local-notion:workspace-feature-tabs-v775",
  fallback: () => ({ ...FALLBACK, updatedAt: Date.now() }),
  sanitize(raw) {
    const value = raw && typeof raw === "object" ? raw as Partial<WorkspaceTabsState> : {};
    const openScreens = sanitizeScreens(value.openScreens);
    const activeScreen = openScreens.includes(value.activeScreen as WorkspaceScreenId)
      ? value.activeScreen as WorkspaceScreenId
      : openScreens[0];
    return { version: 1, openScreens, activeScreen, updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now() };
  },
});

export function openWorkspaceFeatureTab(screen: WorkspaceScreenId): WorkspaceTabsState {
  const definition = getWorkspaceScreen(screen);
  const current = workspaceTabsStore.read();
  if (definition.tabOwnership === "none") return current;
  const openScreens = current.openScreens.includes(screen)
    ? current.openScreens
    : [...current.openScreens, screen].slice(-12);
  const next = { version: 1 as const, openScreens, activeScreen: screen, updatedAt: Date.now() };
  workspaceTabsStore.write(next);
  return next;
}

export function closeWorkspaceFeatureTab(screen: WorkspaceScreenId): WorkspaceTabsState {
  const current = workspaceTabsStore.read();
  if (screen === "documents") return current; // document host stays available; its internal tabs own close behavior.
  const index = current.openScreens.indexOf(screen);
  if (index < 0) return current;
  const openScreens = current.openScreens.filter((item) => item !== screen);
  const fallback = openScreens[Math.min(index, openScreens.length - 1)] ?? "documents";
  const next = {
    version: 1 as const,
    openScreens: openScreens.length > 0 ? openScreens : ["documents" as WorkspaceScreenId],
    activeScreen: current.activeScreen === screen ? fallback : current.activeScreen,
    updatedAt: Date.now(),
  };
  workspaceTabsStore.write(next);
  return next;
}

export function replaceWorkspaceFeatureTabs(openScreens: WorkspaceScreenId[], activeScreen: WorkspaceScreenId): WorkspaceTabsState {
  const sanitized = sanitizeScreens(openScreens);
  const next: WorkspaceTabsState = {
    version: 1,
    openScreens: sanitized,
    activeScreen: sanitized.includes(activeScreen) ? activeScreen : sanitized[0],
    updatedAt: Date.now(),
  };
  workspaceTabsStore.write(next);
  return next;
}

export function reorderWorkspaceFeatureTabs(source: WorkspaceScreenId, target: WorkspaceScreenId): WorkspaceTabsState {
  const current = workspaceTabsStore.read();
  const from = current.openScreens.indexOf(source);
  const to = current.openScreens.indexOf(target);
  if (from < 0 || to < 0 || from == to) return current;
  const openScreens = current.openScreens.slice();
  const [moved] = openScreens.splice(from, 1);
  openScreens.splice(to, 0, moved);
  const next = { ...current, openScreens, updatedAt: Date.now() };
  workspaceTabsStore.write(next);
  return next;
}
