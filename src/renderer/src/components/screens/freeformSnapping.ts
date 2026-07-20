import type { FreeformNode } from "./freeformCanvasModel";

export type FreeformGuide = { axis: "x" | "y"; value: number };

type DragNode = Pick<FreeformNode, "id" | "x" | "y" | "w" | "h">;

const GUIDE_THRESHOLD = 7;

function anchors(node: DragNode) {
  return {
    x: [node.x, node.x + node.w / 2, node.x + node.w],
    y: [node.y, node.y + node.h / 2, node.y + node.h],
  };
}

export function calculateSnapDelta(
  moving: DragNode[],
  stationary: FreeformNode[],
  rawDx: number,
  rawDy: number,
): { dx: number; dy: number; guides: FreeformGuide[] } {
  if (!moving.length || !stationary.length) return { dx: rawDx, dy: rawDy, guides: [] };
  let bestX: { distance: number; correction: number; value: number } | null = null;
  let bestY: { distance: number; correction: number; value: number } | null = null;

  for (const source of moving) {
    const moved = { ...source, x: source.x + rawDx, y: source.y + rawDy };
    const sourceAnchors = anchors(moved);
    for (const target of stationary) {
      const targetAnchors = anchors(target);
      for (const sourceX of sourceAnchors.x) {
        for (const targetX of targetAnchors.x) {
          const correction = targetX - sourceX;
          const distance = Math.abs(correction);
          if (distance <= GUIDE_THRESHOLD && (!bestX || distance < bestX.distance)) {
            bestX = { distance, correction, value: targetX };
          }
        }
      }
      for (const sourceY of sourceAnchors.y) {
        for (const targetY of targetAnchors.y) {
          const correction = targetY - sourceY;
          const distance = Math.abs(correction);
          if (distance <= GUIDE_THRESHOLD && (!bestY || distance < bestY.distance)) {
            bestY = { distance, correction, value: targetY };
          }
        }
      }
    }
  }

  return {
    dx: rawDx + (bestX?.correction || 0),
    dy: rawDy + (bestY?.correction || 0),
    guides: [
      ...(bestX ? [{ axis: "x" as const, value: bestX.value }] : []),
      ...(bestY ? [{ axis: "y" as const, value: bestY.value }] : []),
    ],
  };
}
