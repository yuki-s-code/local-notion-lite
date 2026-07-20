import type { FreeformLink, FreeformNode } from "./freeformCanvasModel";

const COLLAPSED_FRAME_HEIGHT = 68;
const COLLAPSED_FRAME_MIN_WIDTH = 210;
const COLLAPSED_FRAME_MAX_WIDTH = 320;

export type FreeformCollapsedProjection = {
  hiddenNodeIds: Set<string>;
  visibleNodes: FreeformNode[];
  projectedNodeMap: Map<string, FreeformNode>;
  projectedLinks: FreeformLink[];
};

function compactFrameWidth(frame: FreeformNode, childCount: number, externalCount: number) {
  const titleWidth = Math.max(0, frame.title.trim().length) * 8.2;
  const badgesWidth = childCount || externalCount ? 84 : 24;
  return Math.min(
    COLLAPSED_FRAME_MAX_WIDTH,
    Math.max(COLLAPSED_FRAME_MIN_WIDTH, 74 + titleWidth + badgesWidth),
  );
}

/**
 * Builds a display-only graph for collapsed sub-flows.
 * Hidden children are represented by their collapsed frame, parallel proxy
 * edges are merged, and internal edges disappear until the frame is expanded.
 */
export function buildCollapsedProjection(
  nodes: FreeformNode[],
  links: FreeformLink[],
): FreeformCollapsedProjection {
  const sourceNodeMap = new Map(nodes.map((node) => [node.id, node]));
  const collapsedFrames = new Set(
    nodes
      .filter((node) => node.kind === "group" && node.collapsed)
      .map((node) => node.id),
  );

  const collapsedAncestorCache = new Map<string, string | null>();
  const findCollapsedAncestor = (nodeId: string): string | null => {
    const cached = collapsedAncestorCache.get(nodeId);
    if (cached !== undefined) return cached;

    const visited = new Set<string>();
    let current = sourceNodeMap.get(nodeId);
    while (current?.parentFrameId && !visited.has(current.parentFrameId)) {
      visited.add(current.parentFrameId);
      const parent = sourceNodeMap.get(current.parentFrameId);
      if (!parent) break;
      if (collapsedFrames.has(parent.id)) {
        collapsedAncestorCache.set(nodeId, parent.id);
        return parent.id;
      }
      current = parent;
    }

    collapsedAncestorCache.set(nodeId, null);
    return null;
  };

  const hiddenNodeIds = new Set<string>();
  const childCounts = new Map<string, number>();
  for (const node of nodes) {
    const ancestor = findCollapsedAncestor(node.id);
    if (!ancestor) continue;
    hiddenNodeIds.add(node.id);
    childCounts.set(ancestor, (childCounts.get(ancestor) || 0) + 1);
  }

  type ProjectedEdge = FreeformLink & { originalFromId: string; originalToId: string };
  const rawProjectedLinks: ProjectedEdge[] = [];
  const externalCounts = new Map<string, number>();

  for (const link of links) {
    if (!sourceNodeMap.has(link.fromId) || !sourceNodeMap.has(link.toId)) continue;
    const projectedFromId = findCollapsedAncestor(link.fromId) || link.fromId;
    const projectedToId = findCollapsedAncestor(link.toId) || link.toId;
    if (projectedFromId === projectedToId) continue;

    if (collapsedFrames.has(projectedFromId)) {
      externalCounts.set(projectedFromId, (externalCounts.get(projectedFromId) || 0) + 1);
    }
    if (collapsedFrames.has(projectedToId)) {
      externalCounts.set(projectedToId, (externalCounts.get(projectedToId) || 0) + 1);
    }

    rawProjectedLinks.push({
      ...link,
      fromId: projectedFromId,
      toId: projectedToId,
      originalFromId: link.fromId,
      originalToId: link.toId,
      fromHandle: projectedFromId === link.fromId ? link.fromHandle : undefined,
      toHandle: projectedToId === link.toId ? link.toHandle : undefined,
    });
  }

  const visibleNodes = nodes
    .filter((node) => !hiddenNodeIds.has(node.id))
    .map((node) => {
      if (node.kind !== "group" || !node.collapsed) return node;
      const childCount = childCounts.get(node.id) || 0;
      const externalCount = externalCounts.get(node.id) || 0;
      return {
        ...node,
        w: compactFrameWidth(node, childCount, externalCount),
        h: COLLAPSED_FRAME_HEIGHT,
        collapsedChildCount: childCount,
        collapsedExternalCount: externalCount,
      };
    });
  const projectedNodeMap = new Map(visibleNodes.map((node) => [node.id, node]));

  // Merge proxy edges which would otherwise stack on top of each other after
  // several children are projected onto the same collapsed frame.
  const merged = new Map<string, FreeformLink>();
  for (const link of rawProjectedLinks) {
    if (!projectedNodeMap.has(link.fromId) || !projectedNodeMap.has(link.toId)) continue;
    const isProxy = link.fromId !== link.originalFromId || link.toId !== link.originalToId;
    const key = isProxy
      ? `${link.fromId}|${link.toId}|${link.edgeType || "bezier"}`
      : `id:${link.id}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        ...link,
        proxyCount: 1,
        proxyLinkIds: [link.id],
      });
      continue;
    }
    const proxyCount = (current.proxyCount || 1) + 1;
    merged.set(key, {
      ...current,
      proxyCount,
      proxyLinkIds: [...(current.proxyLinkIds || [current.id]), link.id],
      label: current.label || link.label || `${proxyCount}件`,
    });
  }

  return {
    hiddenNodeIds,
    visibleNodes,
    projectedNodeMap,
    projectedLinks: Array.from(merged.values()),
  };
}
