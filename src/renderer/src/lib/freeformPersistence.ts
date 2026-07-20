const DB_NAME = "local-notion-freeform-assets";
const DB_VERSION = 2;
const ASSET_STORE_NAME = "assets";
const BOARD_STORE_NAME = "boards";

export type FreeformAssetRecord = {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  createdAt: number;
};

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME))
        db.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BOARD_STORE_NAME))
        db.createObjectStore(BOARD_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error || new Error("Failed to open freeform asset database"),
      );
  });
}

export async function putFreeformAsset(
  file: Blob,
  fileName: string,
): Promise<string> {
  const db = await openAssetDb();
  const id = `asset:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
    tx.objectStore(ASSET_STORE_NAME).put({
      id,
      blob: file,
      fileName,
      mimeType: file.type,
      createdAt: Date.now(),
    } satisfies FreeformAssetRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error || new Error("Failed to save freeform asset"));
    tx.onabort = () =>
      reject(tx.error || new Error("Freeform asset transaction aborted"));
  });
  db.close();
  return id;
}

export async function getFreeformAsset(
  id: string,
): Promise<FreeformAssetRecord | null> {
  const db = await openAssetDb();
  const result = await new Promise<FreeformAssetRecord | null>(
    (resolve, reject) => {
      const tx = db.transaction(ASSET_STORE_NAME, "readonly");
      const request = tx.objectStore(ASSET_STORE_NAME).get(id);
      request.onsuccess = () =>
        resolve((request.result as FreeformAssetRecord | undefined) || null);
      request.onerror = () =>
        reject(request.error || new Error("Failed to load freeform asset"));
    },
  );
  db.close();
  return result;
}

export async function deleteFreeformAsset(id: string): Promise<void> {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
    tx.objectStore(ASSET_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error || new Error("Failed to delete freeform asset"));
  });
  db.close();
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}


export type FreeformBoardRecord<T = unknown> = {
  id: string;
  value: T;
  updatedAt: number;
};

export async function putFreeformBoard<T>(id: string, value: T): Promise<void> {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOARD_STORE_NAME, "readwrite");
    tx.objectStore(BOARD_STORE_NAME).put({ id, value, updatedAt: Date.now() } satisfies FreeformBoardRecord<T>);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to save freeform board"));
    tx.onabort = () => reject(tx.error || new Error("Freeform board transaction aborted"));
  });
  db.close();
}

export async function getFreeformBoard<T>(id: string): Promise<FreeformBoardRecord<T> | null> {
  const db = await openAssetDb();
  const result = await new Promise<FreeformBoardRecord<T> | null>((resolve, reject) => {
    const tx = db.transaction(BOARD_STORE_NAME, "readonly");
    const request = tx.objectStore(BOARD_STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as FreeformBoardRecord<T> | undefined) || null);
    request.onerror = () => reject(request.error || new Error("Failed to load freeform board"));
  });
  db.close();
  return result;
}
