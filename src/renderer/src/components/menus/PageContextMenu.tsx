import { useMeasuredContextMenuPosition } from "../../hooks/useMeasuredContextMenuPosition";
import { ShelfPickerSubmenu } from "./ShelfPickerSubmenu";
import { useContextMenuDismissal } from "../../hooks/useContextMenuDismissal";
import type { PageContextMenuState } from "../../hooks/usePageContextMenu";

export type PageContextMenuTemplate = {
  key: string;
  title: string;
  icon: string;
};

type Props = {
  state: PageContextMenuState;
  templates: readonly PageContextMenuTemplate[];
  onClose: () => void;
  onOpen: (id: string) => void | Promise<void>;
  onCreateChild: (id: string) => void;
  onCreateFromTemplate: (templateKey: string, parentId: string | null) => void;
  onDuplicate: (id: string) => void;
  onFavorite: (id: string) => void;
  onMoveRoot: (id: string) => void;
  onTrash: (id: string) => void;
  onAddToShelf?: (id: string, shelfId?: string) => void;
};

/** Page-tree menu. This owns only ephemeral menu UI; workspace mutations stay in App. */
export function PageContextMenu({
  state,
  templates,
  onClose,
  onOpen,
  onCreateChild,
  onCreateFromTemplate,
  onDuplicate,
  onFavorite,
  onMoveRoot,
  onTrash,
  onAddToShelf,
}: Props) {
  useContextMenuDismissal(Boolean(state), onClose);

  const { menuRef, position } = useMeasuredContextMenuPosition(
    state ? { x: state.x, y: state.y, maxHeight: state.maxHeight } : null,
    state?.page.id || "",
  );

  if (!state || !position) return null;
  const page = state.page;

  return (
    <div
      ref={menuRef}
      className="context-menu context-menu-v489"
      role="menu"
      aria-label={`${page.title || "ページ"} の操作`}
      style={{ left: position.x, top: position.y, maxHeight: position.maxHeight }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="context-menu-page-title-v489">
        <span aria-hidden="true">{page.icon || "📄"}</span>
        <div>
          <strong>{page.title || "Untitled"}</strong>
          <small>ページ操作</small>
        </div>
      </div>
      <div className="context-menu__scroll" tabIndex={0} aria-label="ページ操作の一覧">
      <div className="context-menu-group-v489">
        <button role="menuitem" onClick={() => { onOpen(page.id); onClose(); }}>
          <span aria-hidden="true">↗</span> 開く
        </button>
        <button role="menuitem" onClick={() => { onCreateChild(page.id); onClose(); }}>
          <span aria-hidden="true">＋</span> 子ページを追加
        </button>
      </div>
      <div className="context-subtitle">テンプレートから作成</div>
      {templates.filter((template) => template.key !== "blank").map((template) => (
        <button
          key={template.key}
          onClick={() => {
            onCreateFromTemplate(template.key, page.id);
            onClose();
          }}
        >
          {template.icon} {template.title}
        </button>
      ))}
      <div className="context-separator" />
      <div className="context-menu-group-v489">
        <button role="menuitem" onClick={() => { onFavorite(page.id); onClose(); }}>
          <span aria-hidden="true">{page.favorite ? "★" : "☆"}</span>{" "}
          {page.favorite ? "お気に入り解除" : "お気に入り"}
        </button>
        <button role="menuitem" onClick={() => { onDuplicate(page.id); onClose(); }}>
          <span aria-hidden="true">⧉</span> 複製
        </button>
        <button
          role="menuitem"
          disabled={!page.parentId}
          onClick={() => { onMoveRoot(page.id); onClose(); }}
        >
          <span aria-hidden="true">⌂</span> ルートへ移動
        </button>
      </div>
      <div className="context-separator" />
      <ShelfPickerSubmenu
        item={{ key: `page:${page.id}`, kind: "page", id: page.id, title: page.title || "無題のページ", icon: page.icon || "📄" }}
        onAdded={(shelfId) => { onAddToShelf?.(page.id, shelfId); onClose(); }}
      />
      <button role="menuitem" className="danger" onClick={() => { onTrash(page.id); onClose(); }}>
        <span aria-hidden="true">⌫</span> ゴミ箱へ移動
      </button>
      </div>
    </div>
  );
}
