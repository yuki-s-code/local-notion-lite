export type ShelfItemKind = "page" | "database" | "journal" | "attachment";
export type CollectionShelfItem = { key: string; kind: ShelfItemKind; id: string; title: string; icon: string; addedAt: number };
export type CollectionShelf = { id: string; name: string; items: CollectionShelfItem[]; createdAt: number };
export const COLLECTION_SHELVES_KEY = "local-notion:workspace-collection-shelves:v1";
const EVENT = "local-notion:collection-shelves-changed";
export function readCollectionShelves(): CollectionShelf[] {
  try { const parsed = JSON.parse(localStorage.getItem(COLLECTION_SHELVES_KEY) || "[]"); if (!Array.isArray(parsed)) return [];
    return parsed.slice(0,12).map((s:any) => ({ id:String(s?.id||""), name:String(s?.name||"資料棚"), createdAt:Number(s?.createdAt||Date.now()), items:Array.isArray(s?.items)?s.items.slice(0,24).map((i:any)=>({ key:String(i?.key||""), kind:["database","journal","attachment"].includes(i?.kind)?i.kind:"page", id:String(i?.id||""), title:String(i?.title||"無題の資料"), icon:String(i?.icon||"📄"), addedAt:Number(i?.addedAt||Date.now()) })).filter((i:CollectionShelfItem)=>i.id):[] })).filter((s:CollectionShelf)=>s.id);
  } catch { return []; }
}
export function writeCollectionShelves(shelves: CollectionShelf[]) { try { localStorage.setItem(COLLECTION_SHELVES_KEY, JSON.stringify(shelves.slice(0,12))); } catch {} window.dispatchEvent(new CustomEvent(EVENT)); }
export function addCollectionItemToDefaultShelf(item: Omit<CollectionShelfItem,"addedAt">): string { const shelves=readCollectionShelves(); const shelf=shelves[0] || { id:`shelf:${Date.now()}:quick`, name:"あとで読む", items:[], createdAt:Date.now() }; const updated={...shelf,items:[{...item,addedAt:Date.now()},...shelf.items.filter((x)=>x.key!==item.key)].slice(0,24)}; writeCollectionShelves([updated,...shelves.filter((x)=>x.id!==shelf.id)]); return updated.name; }
export function addCollectionItemToShelf(shelfId:string,item:Omit<CollectionShelfItem,"addedAt">) { writeCollectionShelves(readCollectionShelves().map((s)=>s.id!==shelfId?s:{...s,items:[{...item,addedAt:Date.now()},...s.items.filter((x)=>x.key!==item.key)].slice(0,24)})); }

/** Removes only the local shelf container. The source pages, databases, journals, and files are never modified. */
export function removeCollectionShelfById(shelfId: string): CollectionShelf[] {
  const next = readCollectionShelves().filter((shelf) => shelf.id !== shelfId);
  writeCollectionShelves(next);
  return next;
}
