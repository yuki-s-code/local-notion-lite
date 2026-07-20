import type { FreeformLink, FreeformNode } from "./freeformCanvasModel";

export type FreeformLayoutMode = "flow-right" | "flow-down" | "grid";
export type FreeformAlignMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type FreeformDistributeMode = "horizontal" | "vertical";

const GAP_X = 120;
const GAP_Y = 90;

function topologicalLayers(nodes: FreeformNode[], links: FreeformLink[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  links.forEach((link) => {
    if (!ids.has(link.fromId) || !ids.has(link.toId)) return;
    incoming.set(link.toId, (incoming.get(link.toId) || 0) + 1);
    outgoing.get(link.fromId)?.push(link.toId);
  });
  const queue = nodes.filter((node) => (incoming.get(node.id) || 0) === 0).map((node) => node.id);
  if (!queue.length && nodes[0]) queue.push(nodes[0].id);
  const layerById = new Map<string, number>();
  queue.forEach((id) => layerById.set(id, 0));
  let index = 0;
  while (index < queue.length) {
    const id = queue[index++];
    const layer = layerById.get(id) || 0;
    for (const next of outgoing.get(id) || []) {
      layerById.set(next, Math.max(layerById.get(next) || 0, layer + 1));
      incoming.set(next, Math.max(0, (incoming.get(next) || 0) - 1));
      if ((incoming.get(next) || 0) === 0) queue.push(next);
    }
  }
  nodes.forEach((node) => {
    if (!layerById.has(node.id)) layerById.set(node.id, 0);
  });
  const layers = new Map<number, FreeformNode[]>();
  nodes.forEach((node) => {
    const layer = layerById.get(node.id) || 0;
    const group = layers.get(layer) || [];
    group.push(node);
    layers.set(layer, group);
  });
  return Array.from(layers.entries()).sort((a, b) => a[0] - b[0]);
}

export function layoutNodes(
  allNodes: FreeformNode[],
  links: FreeformLink[],
  targetIds: Set<string>,
  mode: FreeformLayoutMode,
) {
  const target = allNodes.filter((node) => targetIds.has(node.id) && node.kind !== "drawing");
  if (!target.length) return allNodes;
  const minX = Math.min(...target.map((node) => node.x));
  const minY = Math.min(...target.map((node) => node.y));
  const positions = new Map<string, { x: number; y: number }>();

  if (mode === "grid") {
    const columns = Math.max(2, Math.ceil(Math.sqrt(target.length)));
    const maxW = Math.max(...target.map((node) => node.w));
    const maxH = Math.max(...target.map((node) => node.h));
    target.forEach((node, index) => {
      positions.set(node.id, {
        x: minX + (index % columns) * (maxW + GAP_X),
        y: minY + Math.floor(index / columns) * (maxH + GAP_Y),
      });
    });
  } else {
    const targetLinks = links.filter((link) => targetIds.has(link.fromId) && targetIds.has(link.toId));
    const layers = topologicalLayers(target, targetLinks);
    let primaryOffset = 0;
    for (const [, layerNodes] of layers) {
      const maxPrimary = Math.max(...layerNodes.map((node) => mode === "flow-right" ? node.w : node.h));
      let secondaryOffset = 0;
      for (const node of layerNodes.sort((a, b) => a.y - b.y || a.x - b.x)) {
        positions.set(node.id, mode === "flow-right"
          ? { x: minX + primaryOffset, y: minY + secondaryOffset }
          : { x: minX + secondaryOffset, y: minY + primaryOffset });
        secondaryOffset += (mode === "flow-right" ? node.h : node.w) + GAP_Y;
      }
      primaryOffset += maxPrimary + GAP_X;
    }
  }

  const now = Date.now();
  return allNodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, ...position, updatedAt: now } : node;
  });
}

export function alignNodes(allNodes: FreeformNode[], targetIds: Set<string>, mode: FreeformAlignMode) {
  const target = allNodes.filter((node) => targetIds.has(node.id));
  if (target.length < 2) return allNodes;
  const left = Math.min(...target.map((node) => node.x));
  const right = Math.max(...target.map((node) => node.x + node.w));
  const top = Math.min(...target.map((node) => node.y));
  const bottom = Math.max(...target.map((node) => node.y + node.h));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const now = Date.now();
  return allNodes.map((node) => {
    if (!targetIds.has(node.id)) return node;
    let x = node.x;
    let y = node.y;
    if (mode === "left") x = left;
    if (mode === "center-x") x = centerX - node.w / 2;
    if (mode === "right") x = right - node.w;
    if (mode === "top") y = top;
    if (mode === "center-y") y = centerY - node.h / 2;
    if (mode === "bottom") y = bottom - node.h;
    return { ...node, x, y, updatedAt: now };
  });
}

export function distributeNodes(allNodes: FreeformNode[], targetIds: Set<string>, mode: FreeformDistributeMode) {
  const target = allNodes.filter((node) => targetIds.has(node.id));
  if (target.length < 3) return allNodes;
  const sorted = [...target].sort((a, b) => mode === "horizontal" ? a.x - b.x : a.y - b.y);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSize = sorted.reduce((sum, node) => sum + (mode === "horizontal" ? node.w : node.h), 0);
  const span = mode === "horizontal"
    ? last.x + last.w - first.x
    : last.y + last.h - first.y;
  const gap = Math.max(0, (span - totalSize) / (sorted.length - 1));
  const positions = new Map<string, number>();
  let cursor = mode === "horizontal" ? first.x : first.y;
  sorted.forEach((node) => {
    positions.set(node.id, cursor);
    cursor += (mode === "horizontal" ? node.w : node.h) + gap;
  });
  const now = Date.now();
  return allNodes.map((node) => {
    const value = positions.get(node.id);
    if (value == null) return node;
    return mode === "horizontal"
      ? { ...node, x: value, updatedAt: now }
      : { ...node, y: value, updatedAt: now };
  });
}
