import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  addCollectionItemToDefaultShelf,
  addCollectionItemToShelf,
  readCollectionShelves,
  type CollectionShelfItem,
} from "../../lib/collectionShelves";

export type ShelfPickerItem = Omit<CollectionShelfItem, "addedAt">;

type Props = {
  open: boolean;
  item: ShelfPickerItem | null;
  onClose: () => void;
  onAdded?: (shelfName: string) => void;
};

/**
 * A focused, viewport-safe chooser for the page-level “Add to shelf” action.
 * This deliberately does not default to the first shelf: the destination is
 * explicit before any local data is changed.
 */
export function CollectionShelfPickerDialog({ open, item, onClose, onAdded }: Props) {
  const shelves = useMemo(() => (open ? readCollectionShelves() : []), [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !item || typeof document === "undefined") return null;

  const addToShelf = (shelfId?: string) => {
    if (shelfId) {
      const shelf = shelves.find((candidate) => candidate.id === shelfId);
      addCollectionItemToShelf(shelfId, item);
      onAdded?.(shelf?.name || "選択した本棚");
    } else {
      const shelfName = addCollectionItemToDefaultShelf(item);
      onAdded?.(shelfName);
    }
    onClose();
  };

  return createPortal(
    <div className="collection-shelf-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="collection-shelf-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-shelf-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="collection-shelf-picker-dialog__eyebrow">資料コレクション棚</div>
          <button type="button" onClick={onClose} aria-label="本棚の選択を閉じる">×</button>
        </header>
        <div className="collection-shelf-picker-dialog__resource">
          <span aria-hidden="true">{item.icon || "📄"}</span>
          <div>
            <h2 id="collection-shelf-picker-title">どの本棚に追加しますか？</h2>
            <p title={item.title}>{item.title}</p>
          </div>
        </div>
        <div className="collection-shelf-picker-dialog__list" role="list" aria-label="追加先の本棚">
          {shelves.length ? shelves.map((shelf) => (
            <button key={shelf.id} type="button" role="listitem" onClick={() => addToShelf(shelf.id)}>
              <span className="collection-shelf-picker-dialog__shelf-icon" aria-hidden="true">📚</span>
              <span className="collection-shelf-picker-dialog__shelf-copy">
                <b title={shelf.name}>{shelf.name}</b>
                <small>{shelf.items.length}冊</small>
              </span>
              <span className="collection-shelf-picker-dialog__chevron" aria-hidden="true">›</span>
            </button>
          )) : (
            <div className="collection-shelf-picker-dialog__empty">
              <b>まだ本棚がありません</b>
              <span>最初の「あとで読む」棚を作って追加します。</span>
              <button type="button" onClick={() => addToShelf()}>あとで読むを作成して追加</button>
            </div>
          )}
        </div>
        <footer>
          <span>資料本体は移動・複製されません。</span>
          <button type="button" className="secondary" onClick={onClose}>キャンセル</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
