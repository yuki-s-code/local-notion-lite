import type { WorkspaceScreenDefinition, WorkspaceScreenId } from "./types";

const definitions: WorkspaceScreenDefinition[] = [
  { id: "home", title: "ホーム", icon: "⌂", tabOwnership: "none", singleton: true, canRestore: true },
  { id: "explorer", title: "Explorer", icon: "⌕", tabOwnership: "workspace", singleton: true, canRestore: true },
  { id: "documents", title: "ページ・データベース", icon: "▤", tabOwnership: "screen", singleton: true, canRestore: true },
  { id: "journal", title: "ジャーナル", icon: "◫", tabOwnership: "screen", singleton: true, canRestore: true },
  { id: "inbox", title: "Inbox", icon: "⌁", tabOwnership: "none", singleton: true, canRestore: true },
  { id: "whiteboard", title: "ホワイトボード", icon: "◇", tabOwnership: "workspace", singleton: true, canRestore: true },
  { id: "web-builder", title: "Web Builder", icon: "</>", tabOwnership: "workspace", singleton: true, canRestore: true },
  { id: "external-sources", title: "外部ソース", icon: "↗", tabOwnership: "workspace", singleton: true, canRestore: true },
  { id: "analysis", title: "分析", icon: "⌘", tabOwnership: "workspace", singleton: true, canRestore: true },
  { id: "knowledge-map", title: "ナレッジマップ", icon: "◎", tabOwnership: "workspace", singleton: true, canRestore: true },
  { id: "projects", title: "プロジェクト", icon: "▣", tabOwnership: "workspace", singleton: true, canRestore: true },
  { id: "wiki", title: "Wiki", icon: "W", tabOwnership: "workspace", singleton: true, canRestore: true },
  { id: "glossary", title: "用語集", icon: "A", tabOwnership: "workspace", singleton: true, canRestore: true },
  { id: "utility", title: "管理", icon: "⚙", tabOwnership: "workspace", singleton: true, canRestore: false },
];

const registry = new Map(definitions.map((definition) => [definition.id, definition]));

export function getWorkspaceScreen(id: WorkspaceScreenId): WorkspaceScreenDefinition {
  return registry.get(id) ?? registry.get("home")!;
}

export function listWorkspaceScreens(): WorkspaceScreenDefinition[] {
  return definitions.slice();
}
