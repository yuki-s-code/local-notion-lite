import { useCallback, useState, type MouseEvent } from "react";
import { getViewportContextMenuPosition } from "../lib/contextMenuPosition";
import type { PageTreeNode } from "../../../shared/types";

export type PageContextMenuState = {
  x: number;
  y: number;
  maxHeight: number;
  page: PageTreeNode;
} | null;

/**
 * Keeps the page-tree right-click interaction out of the root workspace shell.
 * The viewport clamp is intentionally kept with this state so callers cannot
 * accidentally open menus off-screen on small displays.
 */
export function usePageContextMenu() {
  const [contextMenu, setContextMenu] = useState<PageContextMenuState>(null);

  const closePageContextMenu = useCallback(() => setContextMenu(null), []);

  const openPageContextMenu = useCallback(
    (event: MouseEvent, page: PageTreeNode) => {
      event.preventDefault();
      event.stopPropagation();
      const position = getViewportContextMenuPosition(
        event.clientX,
        event.clientY,
      );
      setContextMenu({ x: position.x, y: position.y, maxHeight: position.maxHeight, page });
    },
    [],
  );

  return {
    contextMenu,
    openPageContextMenu,
    closePageContextMenu,
  };
}
