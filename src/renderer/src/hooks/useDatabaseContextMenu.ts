import { useCallback, useState, type MouseEvent } from "react";
import { getViewportContextMenuPosition } from "../lib/contextMenuPosition";

export type DatabaseContextMenuState = {
  id: string;
  x: number;
  y: number;
  maxHeight: number;
} | null;

export function useDatabaseContextMenu() {
  const [databaseMenu, setDatabaseMenu] = useState<DatabaseContextMenuState>(null);
  const closeDatabaseContextMenu = useCallback(() => setDatabaseMenu(null), []);
  const openDatabaseContextMenu = useCallback((event: MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDatabaseMenu({ id, ...getViewportContextMenuPosition(event.clientX, event.clientY) });
  }, []);
  return { databaseMenu, openDatabaseContextMenu, closeDatabaseContextMenu };
}
