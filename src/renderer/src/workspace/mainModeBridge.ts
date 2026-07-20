import type { WorkspaceScreenId } from "./types";

export function workspaceScreenForMainMode(mainMode: string): WorkspaceScreenId {
  switch (mainMode) {
    case "explorer": return "explorer";
    case "page":
    case "database": return "documents";
    case "journal": return "journal";
    case "inbox": return "inbox";
    case "canvas": return "whiteboard";
    case "web-builder": return "web-builder";
    case "external-sources": return "external-sources";
    case "analysis": return "analysis";
    case "knowledge-map": return "knowledge-map";
    case "projects": return "projects";
    case "wiki": return "wiki";
    case "glossary": return "glossary";
    case "home": return "home";
    default: return "utility";
  }
}
