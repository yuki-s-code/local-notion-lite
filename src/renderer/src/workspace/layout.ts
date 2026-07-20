import { createVersionedJsonStore } from "./storage";
import type { WorkspaceScreenId } from "./types";

export type WorkspaceDensity = "comfortable" | "compact";
export type WorkspacePresetId = "standard" | "web" | "research" | "whiteboard" | "ai";

export type WorkspaceLayoutState = {
  version: 1;
  preset: WorkspacePresetId;
  density: WorkspaceDensity;
  tabsVisible: boolean;
  updatedAt: number;
};

export type WorkspacePreset = {
  id: WorkspacePresetId;
  title: string;
  description: string;
  screens: WorkspaceScreenId[];
  activeScreen: WorkspaceScreenId;
};

export const WORKSPACE_PRESETS: WorkspacePreset[] = [
  { id: "standard", title: "標準", description: "ページ・DBを中心に作業", screens: ["documents"], activeScreen: "documents" },
  { id: "web", title: "Web制作", description: "Web Builderと資料を往復", screens: ["documents", "web-builder", "whiteboard"], activeScreen: "web-builder" },
  { id: "research", title: "調査", description: "資料・外部ソース・分析", screens: ["documents", "external-sources", "analysis", "knowledge-map"], activeScreen: "external-sources" },
  { id: "whiteboard", title: "ホワイトボード", description: "構想整理と資料参照", screens: ["documents", "whiteboard", "knowledge-map"], activeScreen: "whiteboard" },
  { id: "ai", title: "AI作業", description: "資料・分析・用語を集約", screens: ["documents", "analysis", "glossary", "external-sources"], activeScreen: "analysis" },
];

const fallback = (): WorkspaceLayoutState => ({
  version: 1,
  preset: "standard",
  density: "comfortable",
  tabsVisible: true,
  updatedAt: Date.now(),
});

export const workspaceLayoutStore = createVersionedJsonStore<WorkspaceLayoutState>({
  key: "local-notion:workspace-layout-v776",
  fallback,
  sanitize(raw) {
    const value = raw && typeof raw === "object" ? raw as Partial<WorkspaceLayoutState> : {};
    const preset = WORKSPACE_PRESETS.some((item) => item.id === value.preset) ? value.preset as WorkspacePresetId : "standard";
    return {
      version: 1,
      preset,
      density: value.density === "compact" ? "compact" : "comfortable",
      tabsVisible: value.tabsVisible !== false,
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
    };
  },
});

export function patchWorkspaceLayout(patch: Partial<Omit<WorkspaceLayoutState, "version" | "updatedAt">>): WorkspaceLayoutState {
  const next: WorkspaceLayoutState = {
    ...workspaceLayoutStore.read(),
    ...patch,
    version: 1,
    updatedAt: Date.now(),
  };
  workspaceLayoutStore.write(next);
  return next;
}

export function getWorkspacePreset(id: WorkspacePresetId): WorkspacePreset {
  return WORKSPACE_PRESETS.find((item) => item.id === id) ?? WORKSPACE_PRESETS[0];
}
