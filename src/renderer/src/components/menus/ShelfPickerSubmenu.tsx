import { useEffect, useMemo, useState } from "react";
import {
  addCollectionItemToDefaultShelf,
  addCollectionItemToShelf,
  readCollectionShelves,
  type CollectionShelfItem,
} from "../../lib/collectionShelves";

type Props = {
  item: Omit<CollectionShelfItem, "addedAt">;
  onAdded?: (shelfId?: string) => void;
};

/**
 * Bounded shelf target picker shared by page and database sidebar menus.
 * It replaces the action list in-place, so opening it never grows the outer
 * context menu beyond the viewport or pushes other operations off-screen.
 */
export function ShelfPickerSubmenu({ item, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const shelves = useMemo(() => (open ? readCollectionShelves() : []), [open]);

  useEffect(() => {
    setOpen(false);
  }, [item.key]);

  const addToShelf = (shelfId?: string) => {
    if (shelfId) addCollectionItemToShelf(shelfId, item);
    else addCollectionItemToDefaultShelf(item);
    onAdded?.(shelfId);
  };

  if (!open) {
    return (
      <button
        type="button"
        role="menuitem"
        className="context-shelf-submenu__trigger"
        aria-haspopup="menu"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">📚</span>
        本棚に追加
        <span className="context-shelf-submenu__chevron" aria-hidden="true">›</span>
      </button>
    );
  }

  return (
    <section className="context-shelf-submenu" role="group" aria-label="追加先の本棚">
      <header className="context-shelf-submenu__header">
        <button type="button" className="context-shelf-submenu__back" onClick={() => setOpen(false)} aria-label="操作一覧へ戻る">‹</button>
        <div><strong>本棚に追加</strong><small>追加先を選択</small></div>
      </header>
      <div className="context-shelf-submenu__list" role="menu" aria-label="本棚一覧">
        {shelves.length ? shelves.map((shelf) => (
          <button
            key={shelf.id}
            type="button"
            role="menuitem"
            title={`${shelf.name} に追加`}
            onClick={() => addToShelf(shelf.id)}
          >
            <span className="context-shelf-submenu__name">{shelf.name}</span>
            <em>{shelf.items.length}</em>
          </button>
        )) : (
          <button type="button" role="menuitem" onClick={() => addToShelf()}>
            <span className="context-shelf-submenu__name">あとで読む を作成して追加</span>
          </button>
        )}
      </div>
    </section>
  );
}
