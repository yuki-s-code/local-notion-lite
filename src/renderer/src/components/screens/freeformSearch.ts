import type { FreeformNode } from "./freeformCanvasModel";

export type FreeformSearchResult = {
  id: string;
  title: string;
  subtitle: string;
  node: FreeformNode;
};

export function searchFreeformNodes(nodes: readonly FreeformNode[], query: string): FreeformSearchResult[] {
  const normalized = query.trim().toLocaleLowerCase("ja-JP");
  return nodes
    .filter((node) => {
      if (!normalized) return true;
      return `${node.title} ${node.body || ""} ${node.kind}`
        .toLocaleLowerCase("ja-JP")
        .includes(normalized);
    })
    .slice(0, 30)
    .map((node) => ({
      id: node.id,
      title: node.title || "無題",
      subtitle: node.body?.trim().slice(0, 90) || node.kind,
      node,
    }));
}
