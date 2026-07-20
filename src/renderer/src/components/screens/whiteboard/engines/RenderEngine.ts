import type { FreeformNode } from "../../freeformCanvasModel";
import { projectLowDetailNodes } from "../../freeformCanvasModel";
import { NodeEngine } from "./NodeEngine";

export type RenderWindow = { x: number; y: number; w: number; h: number } | null;

function intersects(node: FreeformNode, viewport: NonNullable<RenderWindow>) {
  return !(
    node.x + node.w < viewport.x ||
    node.x > viewport.x + viewport.w ||
    node.y + node.h < viewport.y ||
    node.y > viewport.y + viewport.h
  );
}

export const RenderEngine = {
  deriveNodes(
    nodes: readonly FreeformNode[],
    options: {
      lowDetail: boolean;
      selectedIds: ReadonlySet<string>;
      viewport: RenderWindow;
      hiddenIds?: ReadonlySet<string>;
    },
  ) {
    const projected = projectLowDetailNodes(
      [...nodes],
      options.lowDetail,
      options.selectedIds,
    );
    const visible = projected.filter((node) => {
      if (options.hiddenIds?.has(node.id)) return false;
      if (options.selectedIds.has(node.id)) return true;
      return options.viewport ? intersects(node, options.viewport) : true;
    });
    return { projected, visible, ...NodeEngine.partition(visible) };
  },
};
