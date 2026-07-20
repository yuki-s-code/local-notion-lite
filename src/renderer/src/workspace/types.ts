export type WorkspaceScreenId =
  | "home"
  | "explorer"
  | "documents"
  | "journal"
  | "inbox"
  | "whiteboard"
  | "web-builder"
  | "external-sources"
  | "analysis"
  | "knowledge-map"
  | "projects"
  | "wiki"
  | "glossary"
  | "utility";

export type WorkspaceTabOwnership = "workspace" | "screen" | "none";

export type WorkspaceScreenDefinition = {
  id: WorkspaceScreenId;
  title: string;
  icon: string;
  tabOwnership: WorkspaceTabOwnership;
  /** Stable instance key. Documents deliberately use one host panel because
   * WorkspaceWorkbench already owns page/database tabs internally. */
  singleton: boolean;
  canRestore: boolean;
};

export type WorkspaceSessionState = {
  version: 1;
  activeScreen: WorkspaceScreenId;
  recentScreens: WorkspaceScreenId[];
  panelState: Record<string, unknown>;
  updatedAt: number;
};
