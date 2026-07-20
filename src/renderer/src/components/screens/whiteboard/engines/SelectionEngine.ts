import type { FreeformNode } from "../../freeformCanvasModel";

export const SelectionEngine = {
  expandGroups(nodes: readonly FreeformNode[], ids: readonly string[]): string[] {
    const selected = new Set(ids);
    const groupIds = new Set(
      nodes.filter((node) => selected.has(node.id) && node.groupId).map((node) => node.groupId),
    );
    if (!groupIds.size) return [...selected];
    for (const node of nodes) {
      if (node.groupId && groupIds.has(node.groupId)) selected.add(node.id);
    }
    return [...selected];
  },

  nodes(nodes: readonly FreeformNode[], ids: readonly string[]): FreeformNode[] {
    const selected = new Set(ids);
    return nodes.filter((node) => selected.has(node.id));
  },
};
