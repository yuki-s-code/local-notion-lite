import type { FreeformNode } from "../../freeformCanvasModel";

export type NodePartitions = {
  cards: FreeformNode[];
  drawings: FreeformNode[];
  frames: FreeformNode[];
};

export const NodeEngine = {
  index(nodes: readonly FreeformNode[]): Map<string, FreeformNode> {
    return new Map(nodes.map((node) => [node.id, node]));
  },

  partition(nodes: readonly FreeformNode[]): NodePartitions {
    const cards: FreeformNode[] = [];
    const drawings: FreeformNode[] = [];
    const frames: FreeformNode[] = [];
    for (const node of nodes) {
      if (node.kind === "drawing") drawings.push(node);
      else cards.push(node);
      if (node.kind === "group") frames.push(node);
    }
    return { cards, drawings, frames };
  },

  byTarget(nodes: readonly FreeformNode[], kind: FreeformNode["kind"], targetId: string) {
    return nodes.find((node) => node.kind === kind && node.targetId === targetId) || null;
  },
};
