import { createVersionedJsonStore } from "./storage";
import type { WorkspaceScreenId, WorkspaceSessionState } from "./types";

const SCREEN_IDS = new Set<WorkspaceScreenId>([
  "home", "documents", "journal", "inbox", "whiteboard", "web-builder",
  "external-sources", "analysis", "knowledge-map", "projects", "wiki",
  "glossary", "utility",
]);

function isScreenId(value: unknown): value is WorkspaceScreenId {
  return typeof value === "string" && SCREEN_IDS.has(value as WorkspaceScreenId);
}

const fallback = (): WorkspaceSessionState => ({
  version: 1,
  activeScreen: "home",
  recentScreens: [],
  panelState: {},
  updatedAt: Date.now(),
});

export const workspaceSessionStore = createVersionedJsonStore<WorkspaceSessionState>({
  key: "local-notion:workspace-session-v774",
  fallback,
  sanitize(raw) {
    const value = raw && typeof raw === "object" ? raw as Partial<WorkspaceSessionState> : {};
    return {
      version: 1,
      activeScreen: isScreenId(value.activeScreen) ? value.activeScreen : "home",
      recentScreens: Array.isArray(value.recentScreens)
        ? Array.from(new Set(value.recentScreens.filter(isScreenId))).slice(0, 12)
        : [],
      panelState: value.panelState && typeof value.panelState === "object" ? value.panelState : {},
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
    };
  },
});

export function rememberWorkspaceScreen(screen: WorkspaceScreenId): WorkspaceSessionState {
  const current = workspaceSessionStore.read();
  const next: WorkspaceSessionState = {
    ...current,
    activeScreen: screen,
    recentScreens: [screen, ...current.recentScreens.filter((item) => item !== screen)].slice(0, 12),
    updatedAt: Date.now(),
  };
  workspaceSessionStore.write(next);
  return next;
}
