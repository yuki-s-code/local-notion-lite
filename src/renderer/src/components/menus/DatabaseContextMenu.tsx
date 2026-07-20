import type { WorkspaceDatabase } from "../../../../shared/types";
import type { DatabaseContextMenuState } from "../../hooks/useDatabaseContextMenu";
import { useMeasuredContextMenuPosition } from "../../hooks/useMeasuredContextMenuPosition";
import { ShelfPickerSubmenu } from "./ShelfPickerSubmenu";
import { useContextMenuDismissal } from "../../hooks/useContextMenuDismissal";

type Props = {
  state: DatabaseContextMenuState;
  database: WorkspaceDatabase | null;
  onClose: () => void;
  onOpenDatabase: (id: string) => void;
  onOpenDatabaseInWorkspace?: (id: string, mode?: "tabs" | "split" | "compare") => void;
};

/** Database sidebar context menu. Keeps shelf selection and floating layout out of the tree. */
export function DatabaseContextMenu({ state, database, onClose, onOpenDatabase, onOpenDatabaseInWorkspace }: Props) {
  useContextMenuDismissal(Boolean(state), onClose, { closeOnBlur: true });
  const { menuRef, position } = useMeasuredContextMenuPosition(
    state ? { x: state.x, y: state.y, maxHeight: state.maxHeight } : null,
    state?.id || "",
  );
  if (!state || !database || !position) return null;
  const openInWorkspace = (mode: "tabs" | "compare") => {
    if (onOpenDatabaseInWorkspace) onOpenDatabaseInWorkspace(database.id, mode);
    else onOpenDatabase(database.id);
    onClose();
  };
  const item = { key: `database:${database.id}`, kind: "database" as const, id: database.id, title: database.title || "無題のデータベース", icon: "▦" };
  return (
    <div ref={menuRef} className="db-sidebar-context-menu-v519" role="menu" aria-label={`${item.title} の操作`} style={{ left: position.x, top: position.y, maxHeight: position.maxHeight }} onClick={(event) => event.stopPropagation()}>
      <div className="db-sidebar-context-title-v519"><span>▦</span><strong title={item.title}>{item.title}</strong></div>
      <div className="db-sidebar-context-menu__scroll" tabIndex={0} aria-label="データベース操作の一覧">
        <button type="button" onClick={() => openInWorkspace("tabs")}>↗ タブで開く</button>
        <button type="button" onClick={() => openInWorkspace("compare")}>⇄ 比較表示で開く</button>
        <div className="db-sidebar-context-separator-v519" />
        <ShelfPickerSubmenu item={item} onAdded={() => onClose()} />
        <button type="button" onClick={() => { onOpenDatabase(database.id); onClose(); }}>✎ 編集画面を開く</button>
      </div>
    </div>
  );
}
