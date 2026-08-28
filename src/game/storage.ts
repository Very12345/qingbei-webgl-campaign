import type { Snapshot } from "./types";

export const SAVE_KEY = "qingbei-webgl-saves-v1";
export const AUTOSAVE_KEY = "qingbei-webgl-unfinished-v1";

const SAVE_DATABASE_NAME = "qingbei-campaign-saves";
const SAVE_DATABASE_VERSION = 1;
const SAVE_STORE_NAME = "snapshots";

const openSaveDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SAVE_DATABASE_NAME, SAVE_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SAVE_STORE_NAME))
        request.result.createObjectStore(SAVE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const readIndexedSnapshot = async (key: string) => {
  try {
    const database = await openSaveDatabase(),
      transaction = database.transaction(SAVE_STORE_NAME, "readonly"),
      request = transaction.objectStore(SAVE_STORE_NAME).get(key),
      value = await new Promise<Snapshot | null>((resolve, reject) => {
        request.onsuccess = () => resolve((request.result as Snapshot) ?? null);
        request.onerror = () => reject(request.error);
      });
    database.close();
    return value;
  } catch {
    return null;
  }
};

export const deleteIndexedSnapshot = async (key: string) => {
  try {
    const database = await openSaveDatabase(),
      transaction = database.transaction(SAVE_STORE_NAME, "readwrite");
    transaction.objectStore(SAVE_STORE_NAME).delete(key);
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
    database.close();
  } catch {
    // localStorage cleanup still prevents a stale save from being offered.
  }
};

export function readSaves(): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || "[]") as Snapshot[];
  } catch {
    return [];
  }
}

export function readAutosave(): Snapshot | null {
  try {
    return JSON.parse(
      localStorage.getItem(AUTOSAVE_KEY) || "null",
    ) as Snapshot | null;
  } catch {
    return null;
  }
}
